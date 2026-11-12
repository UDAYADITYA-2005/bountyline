import { listExpiredCodes, listStuckChecking, transitionClaim, SYSTEM } from '@bountyline/db';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from './deps.js';
import type { PayoutService } from './services/payout-service.js';

/** Moves claims whose one-time code expired before any evidence to `expired`. */
export async function expireCodesOnce(deps: AppDeps): Promise<number> {
  const now = deps.clock.now();
  const ids = await listExpiredCodes(deps.db.db, now);
  for (const claimId of ids) {
    await deps.db.db
      .transaction((tx) =>
        transitionClaim(tx, { claimId, event: 'expire', now, actor: SYSTEM, action: 'expired' }),
      )
      .catch(() => undefined); // Evidence may have arrived in between; the state machine refuses.
  }
  return ids.length;
}

/** Re-runs checks for claims stuck in `checking` for 5 minutes (a run is skipped once decided). */
export async function resumeStuckChecksOnce(deps: AppDeps): Promise<number> {
  const ids = await listStuckChecking(
    deps.db.db,
    new Date(deps.clock.now().getTime() - 5 * 60_000),
  );
  for (const claimId of ids) await deps.checkRunner.start(claimId);
  return ids.length;
}

export interface Loops {
  stop(): Promise<void>;
}

/** Starts the dispatcher (every 2 s) and the reconciler and expirer (every 60 s). Started by server.ts. */
export function startLoops(deps: AppDeps, payouts: PayoutService, log: FastifyBaseLogger): Loops {
  let stopping = false;
  const inflight = new Set<Promise<unknown>>();
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy || stopping) return;
      busy = true;
      const p = fn()
        .catch((err: unknown) => log.error({ err, loop: name }, 'background loop failed'))
        .finally(() => {
          busy = false;
          inflight.delete(p);
        });
      inflight.add(p);
    }, ms);
    timer.unref();
    return timer;
  };
  const timers = [
    every(2_000, 'dispatcher', () => payouts.dispatchOnce()),
    every(60_000, 'reconciler', () => payouts.reconcileOnce()),
    every(60_000, 'expirer', () => expireCodesOnce(deps)),
    every(60_000, 'stuck-checks', () => resumeStuckChecksOnce(deps)),
  ];
  return {
    async stop() {
      stopping = true;
      timers.forEach(clearInterval);
      await Promise.all([...inflight]);
    },
  };
}
