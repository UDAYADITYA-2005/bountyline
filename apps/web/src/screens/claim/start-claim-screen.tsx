import type { ClaimView } from '@bountyline/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { usePrograms, useStartClaim } from '../../api/hooks';
import { Button, EmptyState, ErrorNote, Loading } from '../../components/ui/basics';
import { RequireClaimant } from './require-claimant';

/** Seconds left until an ISO time, ticking each second. */
export function useCountdown(iso: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return 0;
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function IssuedCode({ claim }: { claim: ClaimView }) {
  const left = useCountdown(claim.codeExpiresAt);
  return (
    <section aria-labelledby="code-h" className="space-y-5">
      <div className="bl-ledger rounded-lg border-2 border-ink bg-surface p-6 text-center shadow-card">
        <h2 id="code-h" className="text-sm font-semibold uppercase tracking-widest text-muted">
          Your one-time code
        </h2>
        <p className="bl-code mt-3" aria-label={`Code ${claim.code.split('').join(' ')}`}>
          {claim.code}
        </p>
        <p
          className={`mt-3 font-mono text-lg font-bold ${left < 120 ? 'text-fail' : 'text-ink'}`}
          aria-live="polite"
        >
          {left > 0 ? `Expires in ${formatCountdown(left)}` : 'Code expired. Start a new claim.'}
        </p>
      </div>
      <ol className="space-y-2 rounded-lg border border-line bg-surface p-4 text-base">
        <li>
          <strong>1.</strong> Write <span className="font-mono font-bold">{claim.code}</span> large
          and clear on a card.
        </li>
        <li>
          <strong>2.</strong> Lay the whole fish on its side on a measuring board, nose at zero.
        </li>
        <li>
          <strong>3.</strong> Put the card next to the fish, in good light, and take one photo from
          above.
        </li>
      </ol>
      {left > 0 ? (
        <Link
          to={`/claim/${claim.id}/capture`}
          className="bl-touch flex w-full items-center justify-center rounded-md bg-brand text-lg font-semibold text-brand-ink"
        >
          Open the camera
        </Link>
      ) : null}
    </section>
  );
}

function StartClaim() {
  const programs = usePrograms();
  const start = useStartClaim();
  const [programId, setProgramId] = useState<string>('');

  if (programs.isLoading) return <Loading label="Loading programs…" />;
  if (programs.error)
    return (
      <ErrorNote message={errorMessage(programs.error)} onRetry={() => void programs.refetch()} />
    );
  const list = programs.data ?? [];
  if (list.length === 0)
    return (
      <EmptyState
        title="No programs open"
        body="No bounty program is accepting claims right now."
      />
    );
  if (start.data) return <IssuedCode claim={start.data.claim} />;

  const selected = list.find((p) => p.id === programId);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (selected)
          start.mutate({ programId: selected.id, speciesKey: selected.species[0]?.key });
      }}
    >
      <fieldset className="space-y-3">
        <legend className="font-semibold">Choose a program</legend>
        {list.map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer gap-3 rounded-lg border bg-surface p-4 ${programId === p.id ? 'border-brand ring-2 ring-brand' : 'border-line'}`}
          >
            <input
              type="radio"
              name="program"
              value={p.id}
              checked={programId === p.id}
              onChange={() => setProgramId(p.id)}
              className="mt-1 h-6 w-6"
            />
            <span>
              <span className="block font-semibold">{p.name}</span>
              <span className="block text-sm text-muted">{p.summary}</span>
              <span className="mt-1 block text-sm">
                {p.rewards.tiers
                  .map((t) => `${t.amount.formatted} from fish ${t.fromCount}`)
                  .join(' · ')}
                {p.minAge ? ` · ${p.minAge}+ only` : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {start.error ? <ErrorNote message={errorMessage(start.error)} /> : null}
      <Button type="submit" disabled={!selected || start.isPending} className="w-full text-lg">
        {start.isPending ? 'Issuing code…' : 'Get my one-time code'}
      </Button>
    </form>
  );
}

export function StartClaimScreen() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="font-display text-3xl font-bold">New claim</h1>
      <RequireClaimant>
        <StartClaim />
      </RequireClaimant>
    </div>
  );
}
