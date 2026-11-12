import { Link } from 'react-router';
import { useMe } from '../api/hooks';

const STEPS = [
  ['Start a claim', 'Get a one-time code like K7-42 and write it on a card.'],
  ['Photograph the fish', 'Card and measuring board in the frame. Camera only, no gallery.'],
  ['Checks run live', 'Species, length, code, area, season, photo reuse and claim rate.'],
  ['Get paid by PayPal', 'Plain rules decide. Approved claims pay your PayPal email in minutes.'],
] as const;

export function LandingScreen() {
  const me = useMe();
  const user = me.data;
  return (
    <div className="space-y-10">
      <section className="bl-ledger rounded-lg border border-line bg-surface px-5 py-10 shadow-card sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Wildlife bounty programs
        </p>
        <h1 className="mt-2 max-w-2xl font-display text-4xl font-bold leading-tight sm:text-5xl">
          Prove it, get paid.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Agencies and tribes pay anglers to remove fish that threaten native species. Bountyline
          checks each claim with AI and plain rules, then pays approved claims through PayPal. The
          model never moves money.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/judge"
            className="bl-touch inline-flex items-center rounded-md bg-brand px-6 text-lg font-semibold text-brand-ink"
          >
            Try Judge mode
          </Link>
          {user?.role === 'claimant' ? (
            <Link
              to="/claim"
              className="bl-touch inline-flex items-center rounded-md border border-line bg-surface px-6 font-semibold"
            >
              Start a claim
            </Link>
          ) : (
            <Link
              to="/register"
              className="bl-touch inline-flex items-center rounded-md border border-line bg-surface px-6 font-semibold"
            >
              Create a claimant account
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="font-display text-2xl font-bold">
          How a claim works
        </h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-lg border border-line bg-surface p-4">
              <span className="font-mono text-sm font-bold text-accent">0{i + 1}</span>
              <p className="mt-1 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 text-sm text-muted">
        <p>
          Demo programs are modeled on the Northern Pikeminnow Sport-Reward Fishery (WDFW and BPA),
          which controls a native predator of juvenile salmon, and the Colville Tribes' Northern
          Pike Reward on Lake Roosevelt. Boundaries are simplified. Payments run in the PayPal
          sandbox.
        </p>
      </section>
    </div>
  );
}
