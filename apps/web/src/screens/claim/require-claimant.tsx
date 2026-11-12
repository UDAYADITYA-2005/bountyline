import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { useMe } from '../../api/hooks';
import { EmptyState, ErrorNote, Loading } from '../../components/ui/basics';

/** Renders children only for a signed-in claimant; otherwise explains how to get in. */
export function RequireClaimant({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Loading />;
  if (me.error)
    return <ErrorNote message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  if (!me.data || me.data.role !== 'claimant') {
    return (
      <EmptyState
        title="Sign in as a claimant"
        body="Claims belong to a claimant account, or run a scripted claim in Judge mode."
        action={
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/login" className="bl-touch inline-flex items-center font-semibold underline">
              Sign in
            </Link>
            <Link to="/judge" className="bl-touch inline-flex items-center font-semibold underline">
              Judge mode
            </Link>
          </div>
        }
      />
    );
  }
  return <>{children}</>;
}
