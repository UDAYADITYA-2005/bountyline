import { DeskClaimsResponse, type ClaimView } from '@bountyline/contracts';
import { useEffect, useState } from 'react';
import { apiRequest, errorMessage } from '../api/client';
import { StatusBadge } from '../components/ui/status-badge';
import { emitSelectClaim, onDeskChanged } from './desk-events';
import { ReviewActions } from './review-actions';

async function loadQueue(signal: AbortSignal): Promise<ClaimView[]> {
  const [held, issues] = await Promise.all([
    apiRequest('/desk/claims?status=held&limit=100', DeskClaimsResponse, { signal }),
    apiRequest('/desk/claims?status=payout_issue&limit=100', DeskClaimsResponse, { signal }),
  ]);
  return [...held.claims, ...issues.claims].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** Held and payout_issue claims with Approve, Reject and Request audit actions. */
export function ReviewQueue() {
  const [claims, setClaims] = useState<ClaimView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => onDeskChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    loadQueue(ctrl.signal).then(
      (c) => {
        setClaims(c);
        setError(null);
      },
      (e: unknown) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      },
    );
    return () => ctrl.abort();
  }, [tick]);

  if (error)
    return (
      <p role="alert" className="p-3 text-sm font-semibold text-fail">
        ✕ {error}
      </p>
    );
  if (!claims) return <p className="bl-pulse p-3 text-sm text-muted">Loading the review queue…</p>;
  if (claims.length === 0)
    return <p className="p-3 text-sm text-muted">✓ Nothing to review. Held claims appear here.</p>;

  return (
    <ul className="divide-y divide-line text-sm" aria-label="Claims waiting for review">
      {claims.map((c) => (
        <li key={c.id} className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="text-left font-semibold underline-offset-2 hover:underline"
              onClick={() => emitSelectClaim(c.id)}
            >
              {c.programName} · <span className="font-mono">{c.code}</span>
            </button>
            <StatusBadge status={c.status} size="sm" />
          </div>
          <p className="text-muted">
            {c.reasons.map((r) => r.message).join(' ') || 'No reason recorded.'}
          </p>
          <ReviewActions claim={c} compact />
        </li>
      ))}
    </ul>
  );
}
