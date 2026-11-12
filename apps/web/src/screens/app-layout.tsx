import { NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/hooks';
import { OfflineBanner } from '../components/ui/basics';

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  `bl-touch inline-flex items-center rounded-md px-3 text-sm font-semibold ${
    isActive ? 'bg-brand-soft text-ink' : 'text-muted hover:text-ink'
  }`;

export function AppLayout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = me.data;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <OfflineBanner />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <NavLink
            to="/"
            className="bl-touch mr-auto inline-flex items-center gap-2"
            aria-label="Bountyline home"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-mono font-bold text-brand-ink"
            >
              B
            </span>
            <span className="font-display text-xl font-bold tracking-tight">Bountyline</span>
          </NavLink>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            <NavLink to="/judge" className={linkClass}>
              Judge mode
            </NavLink>
            {user?.role === 'claimant' ? (
              <>
                <NavLink to="/claim" end className={linkClass}>
                  New claim
                </NavLink>
                <NavLink to="/me" className={linkClass}>
                  My claims
                </NavLink>
              </>
            ) : null}
            {user?.role === 'manager' ? (
              <NavLink to="/desk" className={linkClass}>
                Desk
              </NavLink>
            ) : null}
            {user ? (
              <button
                type="button"
                className="bl-touch rounded-md px-3 text-sm font-semibold text-muted hover:text-ink"
                onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/') })}
              >
                Sign out
              </button>
            ) : (
              <NavLink to="/login" className={linkClass}>
                Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        Bountyline. Prove it, get paid. · PayPal sandbox only · Demo programs, not official
        boundaries
      </footer>
    </div>
  );
}
