import type { MyClaimsResponse } from '@bountyline/contracts';
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { useMyClaims, usePrograms } from '../../api/hooks';
import { EmptyState, ErrorNote, Loading, Money } from '../../components/ui/basics';
import { ClaimCard } from '../../components/ui/claim-card';
import { RequireClaimant } from './require-claimant';

type TierProgress = NonNullable<MyClaimsResponse['totals']['tierProgress']>[number];

/** "12 of 25 at $6.00", or the flat rate when there is no next tier. Figures come from the API. */
export function tierProgressText(t: TierProgress): string {
  if (t.nextTierAt === null) return `${t.seasonCount} this season at ${t.currentAmount.formatted}`;
  return `${t.seasonCount} of ${t.nextTierAt - 1} at ${t.currentAmount.formatted}`;
}

function MyClaims() {
  const mine = useMyClaims();
  const programs = usePrograms();
  if (mine.isLoading) return <Loading label="Loading your claims…" />;
  if (mine.error)
    return <ErrorNote message={errorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  const data = mine.data;
  if (!data) return null;
  const name = (id: string): string => programs.data?.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <dt className="text-xs font-semibold uppercase text-muted">Paid</dt>
          <dd className="mt-1 text-xl">
            <Money value={data.totals.paid} />
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <dt className="text-xs font-semibold uppercase text-muted">Pending</dt>
          <dd className="mt-1 text-xl">
            <Money value={data.totals.pending} />
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <dt className="text-xs font-semibold uppercase text-muted">This season</dt>
          <dd className="mt-1 font-mono text-xl font-bold">{data.totals.seasonCount}</dd>
        </div>
      </dl>
      {data.totals.tierProgress && data.totals.tierProgress.length > 0 ? (
        <section aria-labelledby="tiers-h" className="rounded-lg border border-line bg-surface p-4">
          <h2 id="tiers-h" className="font-semibold">
            Reward tiers
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.totals.tierProgress.map((t) => (
              <li key={t.programId}>
                <span className="font-semibold">{name(t.programId)}:</span> {tierProgressText(t)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.claims.length === 0 ? (
        <EmptyState
          title="No claims yet"
          action={
            <Link
              to="/claim"
              className="bl-touch inline-flex items-center rounded-md bg-brand px-5 font-semibold text-brand-ink"
            >
              Start your first claim
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.claims.map((c) => (
            <li key={c.id}>
              <ClaimCard claim={c} to={`/claim/${c.id}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MyClaimsScreen() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">My claims</h1>
      <RequireClaimant>
        <MyClaims />
      </RequireClaimant>
    </div>
  );
}
