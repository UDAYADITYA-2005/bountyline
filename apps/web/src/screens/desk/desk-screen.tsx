import { Component, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../../api/client';
import { useJudgeSession, useLogout, useMe, usePool } from '../../api/hooks';
import { Button, EmptyState, ErrorNote, Loading, OfflineBanner } from '../../components/ui/basics';
import { ClaimEvidence } from '../../desk/claim-evidence';
import { onSelectClaim } from '../../desk/desk-events';
import { ReviewQueue } from '../../desk/review-queue';
import { StudioDesk } from '../../desk/studio-desk';

/** If AG Studio fails to start, the desk still works with the plain review queue. */
class StudioBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="space-y-3 p-4">
        <ErrorNote message="The analytics dashboard could not start. The review queue below still works." />
        <div className="rounded-lg border border-line bg-surface">
          <ReviewQueue />
        </div>
      </div>
    );
  }
}

function PoolStrip() {
  const pool = usePool();
  if (pool.isLoading) return <span className="text-sm text-muted">Pool…</span>;
  if (pool.error) return <span className="text-sm text-fail">Pool unavailable</span>;
  return (
    <ul className="flex flex-wrap gap-4 text-sm" aria-label="Program pools">
      {(pool.data ?? []).map((p) => (
        <li key={p.programId}>
          <span className="text-muted">{p.programId}:</span>{' '}
          <span className="font-mono font-bold text-money">{p.available.formatted}</span> available
          · <span className="font-mono">{p.paidToday.formatted}</span> paid today ·{' '}
          <span className="font-mono">{p.reserved.formatted}</span> reserved
        </li>
      ))}
    </ul>
  );
}

function Drawer({ claimId, onClose }: { claimId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      aria-label="Claim review"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-line bg-surface shadow-card"
    >
      <div className="flex items-center justify-between border-b border-line p-3">
        <h2 className="font-display text-lg font-bold">Claim review</h2>
        <Button variant="secondary" onClick={onClose} ariaLabel="Close claim review">
          Close
        </Button>
      </div>
      <ClaimEvidence claimId={claimId} />
    </aside>
  );
}

export default function DeskScreen() {
  const me = useMe();
  const judge = useJudgeSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [drawer, setDrawer] = useState<string | null>(null);

  useEffect(() => onSelectClaim(setDrawer), []);

  if (me.isLoading) return <Loading label="Checking your session…" />;
  if (me.error)
    return <ErrorNote message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  if (me.data?.role !== 'manager') {
    return (
      <div className="mx-auto max-w-lg p-6">
        <EmptyState
          title="The desk is for program managers"
          body="Sign in as a manager, or open the desk with the Judge mode demo manager."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => judge.mutate('manager')} disabled={judge.isPending}>
                Open as demo manager
              </Button>
              <Link
                to="/login"
                className="bl-touch inline-flex items-center font-semibold underline"
              >
                Sign in
              </Link>
            </div>
          }
        />
        {judge.error ? <ErrorNote message={errorMessage(judge.error)} /> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <OfflineBanner />
      <header className="border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
          <Link to="/" className="bl-touch inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-mono font-bold text-brand-ink"
            >
              B
            </span>
            <span className="font-display text-xl font-bold">Bountyline desk</span>
          </Link>
          <nav aria-label="Desk" className="flex flex-wrap items-center gap-2">
            <Link
              to="/judge"
              className="bl-touch inline-flex items-center px-2 text-sm font-semibold text-muted hover:text-ink"
            >
              Judge hub
            </Link>
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{me.data.displayName}</span>
            <Button
              variant="secondary"
              onClick={() => setMode((m) => (m === 'view' ? 'edit' : 'view'))}
            >
              {mode === 'view' ? 'Edit dashboard' : 'Done editing'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/') })}
            >
              Sign out
            </Button>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2">
          <PoolStrip />
        </div>
      </header>
      <main className="flex-1 p-2">
        <StudioBoundary>
          <StudioDesk mode={mode} />
        </StudioBoundary>
      </main>
      {drawer ? <Drawer claimId={drawer} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}
