import type { ClaimView } from '@bountyline/contracts';
import { Link } from 'react-router';
import { Money } from './basics';
import { StatusBadge } from './status-badge';

export function ClaimCard({ claim, to }: { claim: ClaimView; to: string }) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-line bg-surface p-4 shadow-card transition hover:border-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{claim.programName}</p>
          <p className="mt-0.5 text-sm text-muted">
            <span className="font-mono">{claim.code}</span> ·{' '}
            {new Date(claim.createdAt).toLocaleString()}
          </p>
        </div>
        {claim.amount ? <Money value={claim.amount} className="text-lg" /> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={claim.status} size="sm" />
        {claim.source === 'judge_scenario' ? (
          <span className="text-xs text-muted">Judge scenario</span>
        ) : null}
      </div>
    </Link>
  );
}
