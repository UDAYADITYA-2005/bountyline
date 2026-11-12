import type { ClaimView } from '@bountyline/contracts';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, errorMessage } from '../../api/client';
import { useClaimStream } from '../../api/use-claim-stream';
import {
  EmptyState,
  ErrorNote,
  Loading,
  Money,
  PhotoFrame,
  SimTag,
} from '../../components/ui/basics';
import { CheckRow } from '../../components/ui/check-row';
import { StatusBadge, statusLabel } from '../../components/ui/status-badge';

const PAYOUT_WORDS: Record<string, string> = {
  queued: 'Queued for PayPal',
  sending: 'Sending to PayPal',
  sent: 'Sent; waiting for PayPal to confirm',
  succeeded: 'Confirmed by PayPal',
  failed: 'PayPal could not pay',
};

function ResultPanel({ claim }: { claim: ClaimView }) {
  const reasons = claim.reasons.length > 0 && (
    <ul className="mt-3 space-y-2">
      {claim.reasons.map((r) => (
        <li key={`${r.code}-${r.checkKey ?? ''}`} className="flex gap-2">
          <span aria-hidden="true">•</span>
          <span>{r.message}</span>
        </li>
      ))}
    </ul>
  );
  switch (claim.status) {
    case 'code_issued':
      return (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="font-semibold">Waiting for your photo.</p>
          <Link
            to={`/claim/${claim.id}/capture`}
            className="bl-touch mt-3 inline-flex items-center rounded-md bg-brand px-5 font-semibold text-brand-ink"
          >
            Open the camera
          </Link>
        </div>
      );
    case 'checking':
      return (
        <p className="rounded-lg border border-info bg-info-soft p-5 font-semibold text-info">
          Running the checks…
        </p>
      );
    case 'approved':
    case 'paying':
    case 'paid':
      return (
        <div className="rounded-lg border-2 border-pass bg-pass-soft p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-pass">
            {claim.status === 'paid' ? 'Paid' : 'Approved, paying now'}
          </p>
          {claim.amount ? <Money value={claim.amount} className="mt-1 block text-5xl" /> : null}
          <p className="mt-2 text-sm">
            PayPal:{' '}
            {claim.payout
              ? (PAYOUT_WORDS[claim.payout.status] ?? claim.payout.status)
              : 'Preparing the payout'}
            {claim.payout?.paypalItemId ? (
              <span className="ml-1 font-mono text-xs">({claim.payout.paypalItemId})</span>
            ) : null}
          </p>
          {reasons}
        </div>
      );
    case 'held':
      return (
        <div className="rounded-lg border-2 border-hold bg-hold-soft p-5">
          <p className="font-semibold text-hold">Held for a program manager</p>
          {reasons}
          <p className="mt-3 text-sm">
            A manager reviews held claims on the desk. If they approve it, it pays automatically and
            this page updates.
          </p>
        </div>
      );
    case 'payout_issue':
      return (
        <div className="rounded-lg border-2 border-fail bg-fail-soft p-5">
          <p className="font-semibold text-fail">
            The claim was approved, but the payout needs attention
          </p>
          {reasons}
          <p className="mt-3 text-sm">A program manager will retry or resolve it.</p>
        </div>
      );
    case 'rejected':
      return (
        <div className="rounded-lg border-2 border-fail bg-fail-soft p-5">
          <p className="font-semibold text-fail">Not approved</p>
          {reasons}
        </div>
      );
    case 'expired':
      return (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="font-semibold">The code expired before a photo arrived.</p>
          <Link
            to="/claim"
            className="bl-touch mt-3 inline-flex items-center font-semibold underline"
          >
            Start a new claim
          </Link>
        </div>
      );
  }
}

/** Announces status changes once, in words, for screen readers. */
function useAnnouncement(claim: ClaimView | undefined): string {
  const [text, setText] = useState('');
  const last = useRef('');
  useEffect(() => {
    if (!claim) return;
    const done = claim.checks.filter((c) => c.status !== 'pending').length;
    const next = `${statusLabel(claim.status)}. ${done} of ${claim.checks.length} checks done.`;
    if (next !== last.current) {
      last.current = next;
      setText(next);
    }
  }, [claim]);
  return text;
}

export function ClaimScreen() {
  const { id = '' } = useParams();
  const { claim, state, query } = useClaimStream(id);
  const announcement = useAnnouncement(claim);

  if (query.isLoading) return <Loading label="Loading the claim…" />;
  if (query.error) {
    if (
      query.error instanceof ApiError &&
      (query.error.status === 401 || query.error.status === 403)
    ) {
      return (
        <EmptyState
          title="This claim isn't yours to view"
          body="Sign in with the account that made it."
        />
      );
    }
    if (query.error instanceof ApiError && query.error.status === 404)
      return <EmptyState title="Claim not found" />;
    return <ErrorNote message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!claim) return <EmptyState title="Claim not found" />;
  const judge = claim.source === 'judge_scenario';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{claim.programName}</p>
          <h1 className="font-display text-2xl font-bold">
            Claim <span className="font-mono">{claim.code}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={claim.status} />
          <span className="text-xs text-muted">
            {state === 'live' ? 'Live' : state === 'polling' ? 'Refreshing' : ''}
          </span>
        </div>
      </header>
      {judge ? (
        <div className="flex flex-wrap gap-2" aria-label="Simulated in Judge mode">
          <SimTag>Judge scenario</SimTag>
          <SimTag>Sample photo</SimTag>
          <SimTag>Simulated location</SimTag>
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <PhotoFrame
            src={claim.photoUrl}
            alt="Evidence photo"
            label={judge ? 'Sample photo' : undefined}
          />
          {claim.location ? (
            <p className="text-sm text-muted">
              {judge ? 'Simulated location' : 'Location'}: {claim.location.lat.toFixed(3)},{' '}
              {claim.location.lng.toFixed(3)} (±
              {claim.location.accuracyM} m)
            </p>
          ) : null}
          <ResultPanel claim={claim} />
        </div>
        <section
          aria-labelledby="checks-h"
          className="rounded-lg border border-line bg-surface px-4"
        >
          <h2 id="checks-h" className="pt-4 font-semibold">
            Checks
          </h2>
          {claim.checks.length === 0 ? (
            <p className="py-4 text-sm text-muted">Checks start when the photo arrives.</p>
          ) : (
            <ul>
              {claim.checks.map((c) => (
                <CheckRow
                  key={c.key}
                  check={c}
                  simulatedNote={
                    judge && c.key === 'code_in_frame' && c.status === 'skipped'
                      ? 'Skipped: sample photo has no code card'
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
