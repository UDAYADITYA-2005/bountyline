import { ClaimDetailResponse } from '@bountyline/contracts';
import type { z } from 'zod';
import { useEffect, useState } from 'react';
import { apiRequest, errorMessage } from '../api/client';
import { Money, PhotoFrame } from '../components/ui/basics';
import { CheckRow } from '../components/ui/check-row';
import { StatusBadge } from '../components/ui/status-badge';
import { onDeskChanged } from './desk-events';
import { ReviewActions } from './review-actions';

type Detail = z.infer<typeof ClaimDetailResponse>;

/** Loads one claim's desk detail and reloads it whenever the desk changes. */
export function useDeskClaimDetail(claimId: string | null) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => onDeskChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (!claimId) {
      setDetail(null);
      return;
    }
    const ctrl = new AbortController();
    apiRequest(`/desk/claims/${encodeURIComponent(claimId)}`, ClaimDetailResponse, {
      signal: ctrl.signal,
    }).then(
      (d) => {
        setDetail(d);
        setError(null);
      },
      (e: unknown) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      },
    );
    return () => ctrl.abort();
  }, [claimId, tick]);
  return { detail, error };
}

/** Photo, every check with status and detail, reasons, actions and the decision log for a claim. */
export function ClaimEvidence({
  claimId,
  showHistory = true,
}: {
  claimId: string | null;
  showHistory?: boolean;
}) {
  const { detail, error } = useDeskClaimDetail(claimId);
  if (!claimId)
    return (
      <p className="p-3 text-sm text-muted">Select a claim in the grid or the review queue.</p>
    );
  if (error)
    return (
      <p role="alert" className="p-3 text-sm font-semibold text-fail">
        ✕ {error}
      </p>
    );
  if (!detail) return <p className="bl-pulse p-3 text-sm text-muted">Loading claim…</p>;
  const { claim, history } = detail;
  const judge = claim.source === 'judge_scenario';
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{claim.programName}</p>
          <p className="font-mono text-xs text-muted">{claim.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {claim.amount ? <Money value={claim.amount} /> : null}
          <StatusBadge status={claim.status} size="sm" />
        </div>
      </div>
      <PhotoFrame
        src={claim.photoUrl}
        alt={`Evidence for claim ${claim.code}`}
        label={judge ? 'Sample photo' : undefined}
      />
      {claim.location ? (
        <p className="text-xs text-muted">
          {judge ? 'Simulated location' : 'Location'}: {claim.location.lat}, {claim.location.lng} (±
          {claim.location.accuracyM} m) · Audit: {claim.audit}
        </p>
      ) : null}
      {claim.reasons.length > 0 ? (
        <ul className="space-y-1 rounded-sm bg-hold-soft p-2 text-hold">
          {claim.reasons.map((r) => (
            <li key={`${r.code}-${r.checkKey ?? ''}`}>
              <span className="font-mono text-xs">{r.code}</span> {r.message}
            </li>
          ))}
        </ul>
      ) : null}
      <ReviewActions claim={claim} compact />
      <ul>
        {claim.checks.map((c) => (
          <CheckRow key={c.key} check={c} />
        ))}
      </ul>
      {showHistory && history.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-semibold">
            Decision log ({history.length})
          </summary>
          <ol className="mt-2 space-y-1">
            {history.map((h) => (
              <li key={h.id} className="text-xs">
                <span className="font-mono">{new Date(h.at).toLocaleString()}</span> · {h.actorType}{' '}
                · {h.action}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
