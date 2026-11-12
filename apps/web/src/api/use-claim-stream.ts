import { ClaimView, FINAL_CLAIM_STATUSES } from '@bountyline/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './client';
import { qk, useClaim } from './hooks';

export type StreamState = 'connecting' | 'live' | 'polling' | 'closed';

const isFinal = (c: ClaimView): boolean => FINAL_CLAIM_STATUSES.includes(c.status);

/** Statuses after which the claim won't change without a human, so the stream can stop. */
const SETTLED = new Set(['paid', 'rejected', 'expired', 'held', 'payout_issue']);

/**
 * Live claim updates over SSE (`event: claim`), written into the TanStack Query cache.
 * Reconnects with backoff; after three failures it falls back to polling every 2 s.
 */
export function useClaimStream(id: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const failures = useRef(0);
  // Polls when SSE is unavailable, and slowly while a held claim waits for the desk.
  const query = useClaim(id, {
    refetchInterval: (c) => {
      if (c && isFinal(c)) return false;
      if (state === 'polling') return 2_000;
      return c && SETTLED.has(c.status) ? 10_000 : false;
    },
  });
  const claim = query.data;
  const settled = claim !== undefined && (isFinal(claim) || SETTLED.has(claim.status));

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setState('polling');
      return;
    }
    if (settled) {
      setState('closed');
      return;
    }
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = (): void => {
      setState('connecting');
      source = new EventSource(`${API_BASE}/claims/${encodeURIComponent(id)}/stream`, {
        withCredentials: true,
      });
      source.addEventListener('open', () => {
        failures.current = 0;
        setState('live');
      });
      source.addEventListener('claim', (e: MessageEvent<string>) => {
        let data: unknown;
        try {
          data = JSON.parse(e.data) as unknown;
        } catch {
          return;
        }
        const parsed = ClaimView.safeParse(data);
        if (parsed.success) qc.setQueryData(qk.claim(id), parsed.data);
      });
      source.addEventListener('error', () => {
        source?.close();
        if (stopped) return;
        failures.current += 1;
        if (failures.current >= 3) {
          setState('polling');
          return;
        }
        timer = setTimeout(connect, 500 * 2 ** failures.current);
      });
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [id, qc, settled]);

  return { claim, state: settled ? 'closed' : state, query };
}
