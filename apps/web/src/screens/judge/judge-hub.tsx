import type { ScenarioView } from '@bountyline/contracts';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, errorMessage } from '../../api/client';
import { useJudgeSession, useMe, useRunScenario, useScenarios } from '../../api/hooks';
import { Button, EmptyState, ErrorNote, Loading, SimTag } from '../../components/ui/basics';
import { useToast } from '../../components/ui/toast';

// Presentation copy only: what each scripted scenario demonstrates. Outcomes come from the API.
const PROVES: Record<string, string> = {
  'clean-pikeminnow':
    'The full happy path: checks pass, rules approve, PayPal pays the sandbox account.',
  'clean-pikeminnow-2': 'Reward tiers count per claimant across the season.',
  'reused-photo': 'Photo reuse is caught by perceptual hash against last week’s paid claim.',
  'out-of-area': 'A location outside the program polygon holds the claim for a manager.',
  'wrong-species': 'The vision check spots a look-alike species, and the rules reject it.',
  undersized: 'A fish under the program minimum length is rejected.',
  'pike-clean': 'A second program with a flat $10 reward on Lake Roosevelt.',
};

const EXPECT_LABEL: Record<ScenarioView['expect'], string> = {
  approve: 'Expected: approve and pay',
  hold: 'Expected: hold for review',
  reject: 'Expected: reject',
};

export function JudgeHub() {
  const scenarios = useScenarios();
  const me = useMe();
  const session = useJudgeSession();
  const run = useRunScenario();
  const navigate = useNavigate();
  const toast = useToast();
  const [running, setRunning] = useState<string | null>(null);

  const isJudgeClaimant = me.data?.judge === true && me.data.role === 'claimant';

  async function runScenario(id: string): Promise<void> {
    setRunning(id);
    try {
      if (!isJudgeClaimant) await session.mutateAsync('claimant');
      const { claim } = await run.mutateAsync(id);
      void navigate(`/claim/${claim.id}`);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setRunning(null);
    }
  }

  async function openDesk(): Promise<void> {
    try {
      await session.mutateAsync('manager');
      void navigate('/desk');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  }

  async function reset(): Promise<void> {
    try {
      await session.mutateAsync('claimant');
      toast.show('New judge session started. Earlier claims stay on the desk.');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  }

  if (scenarios.isLoading) return <Loading label="Loading scenarios…" />;
  if (scenarios.error) {
    if (scenarios.error instanceof ApiError && scenarios.error.code === 'JUDGE_MODE_OFF') {
      return (
        <EmptyState title="Judge mode is off" body="This deployment runs without Judge mode." />
      );
    }
    return (
      <ErrorNote message={errorMessage(scenarios.error)} onRetry={() => void scenarios.refetch()} />
    );
  }
  const list = scenarios.data ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">Judge mode</h1>
        <p className="max-w-2xl text-muted">
          You can't catch a fish, so each scenario submits a sample photo with a simulated location.
          Every check, the rules, the decision log and the PayPal sandbox payout are real. No login
          needed.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="What is simulated">
          <li>
            <SimTag>Sample photo</SimTag>
          </li>
          <li>
            <SimTag>Simulated location and time</SimTag>
          </li>
          <li>
            <SimTag>Code check skipped on sample photos</SimTag>
          </li>
        </ul>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void openDesk()} disabled={session.isPending}>
            Open the desk as manager
          </Button>
          <Button variant="secondary" onClick={() => void reset()} disabled={session.isPending}>
            Reset my session
          </Button>
        </div>
        {me.data?.judge ? (
          <p className="text-sm text-muted">
            Signed in as {me.data.displayName} ({me.data.role}). Payouts go to{' '}
            {me.data.paypalEmailMasked ?? 'the sandbox account'}.
          </p>
        ) : null}
      </header>

      {list.length === 0 ? (
        <EmptyState title="No scenarios" body="The scenario pack is empty." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card"
            >
              <div className="relative">
                <img
                  src={s.photoUrl}
                  alt={`Sample photo for ${s.title}`}
                  className="aspect-[16/9] w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute left-2 top-2">
                  <SimTag>Sample photo</SimTag>
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  {EXPECT_LABEL[s.expect]}
                </p>
                <h2 className="font-display text-xl font-bold">{s.title}</h2>
                <p className="text-sm">{s.story}</p>
                <p className="text-sm text-muted">{PROVES[s.id] ?? s.story}</p>
                <p className="text-xs text-muted">
                  {s.realCode
                    ? 'Code card in photo: code check runs for real'
                    : 'Code check: skipped (sample photo)'}
                </p>
                <div className="mt-auto pt-2">
                  <Button
                    onClick={() => void runScenario(s.id)}
                    disabled={running !== null}
                    className="w-full"
                  >
                    {running === s.id ? 'Running…' : 'Run this scenario'}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
