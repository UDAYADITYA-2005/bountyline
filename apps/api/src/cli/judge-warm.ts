import { argValue, ScriptClient, sleep } from './http.js';

// `pnpm judge:warm --url https://<service>.onrender.com`: runs every Judge scenario once so the
// vision cache is warm after a deploy. Each scenario gets its own judge session (no collisions).
const base = (argValue('url') ?? 'http://localhost:3000').replace(/\/$/, '');
const list = await new ScriptClient(base).call('GET', '/api/v1/judge/scenarios');
const scenarios = (list.json.scenarios ?? []) as { id: string; expect: string }[];
if (list.status !== 200) {
  process.stderr.write(`Could not list scenarios (${list.status}). Is JUDGE_MODE=true?\n`);
  process.exit(1);
}
let misses = 0;
for (const s of scenarios) {
  const c = new ScriptClient(base);
  await c.call('POST', '/api/v1/judge/session', { as: 'claimant' });
  const run = await c.call('POST', `/api/v1/judge/scenarios/${s.id}/run`);
  const claim = run.json.claim as { id: string } | undefined;
  let status = 'error';
  for (let i = 0; claim && i < 40; i += 1) {
    const got = await c.call('GET', `/api/v1/claims/${claim.id}`);
    status = String((got.json.claim as { status?: string } | undefined)?.status ?? 'error');
    if (status !== 'checking') break;
    await sleep(1500);
  }
  const outcome =
    status === 'approved' || status === 'paying' || status === 'paid'
      ? 'approve'
      : status === 'held'
        ? 'hold'
        : status === 'rejected'
          ? 'reject'
          : status;
  if (outcome !== s.expect) misses += 1;
  process.stdout.write(
    `${s.id.padEnd(20)} expected ${s.expect.padEnd(8)} got ${outcome} (${status})\n`,
  );
}
process.stdout.write(
  misses
    ? `${misses} scenario(s) differ from expected.\n`
    : 'All scenarios match. Vision cache is warm.\n',
);
process.exit(misses ? 1 : 0);
