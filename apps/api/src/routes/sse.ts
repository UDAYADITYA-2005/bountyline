import { FINAL_CLAIM_STATUSES } from '@bountyline/contracts';
import { getClaim } from '@bountyline/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../services.js';

export const SSE_POLL_MS = 750;
export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_CLOSE_AFTER_FINAL_MS = 5_000;
const SSE_MAX_MS = 15 * 60_000;

/**
 * Server-sent events for one claim: `event: claim` with a ClaimView whenever updated_at changes
 * (polled every 750 ms), a comment heartbeat every 15 s, closed 5 s after a final state.
 */
export function streamClaim(
  req: FastifyRequest,
  reply: FastifyReply,
  s: Services,
  claimId: string,
  exactLocation: boolean,
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  let lastSeen = '';
  let closed = false;
  let finalAt: number | null = null;
  const started = Date.now();

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    res.end();
  };

  const tick = async () => {
    if (closed) return;
    try {
      const claim = await getClaim(s.deps.db.db, claimId);
      if (!claim || closed) return close();
      const stamp = claim.updatedAt.toISOString();
      if (stamp !== lastSeen) {
        lastSeen = stamp;
        const view = await s.claims.view(claim, exactLocation);
        res.write(`event: claim\ndata: ${JSON.stringify(view)}\n\n`);
      }
      if (FINAL_CLAIM_STATUSES.includes(claim.status) && finalAt === null) finalAt = Date.now();
      if (
        (finalAt !== null && Date.now() - finalAt >= SSE_CLOSE_AFTER_FINAL_MS) ||
        Date.now() - started > SSE_MAX_MS
      )
        close();
    } catch (err) {
      req.log.warn({ err, claimId }, 'sse poll failed');
    }
  };

  let busy = false;
  const poll = setInterval(() => {
    if (busy) return;
    busy = true;
    void tick().finally(() => {
      busy = false;
    });
  }, SSE_POLL_MS);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, SSE_HEARTBEAT_MS);
  // Stop polling as soon as the client goes away.
  req.raw.on('close', close);
  void tick();
}
