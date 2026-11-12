import { readProcessVar } from '@bountyline/config';
import sharp from 'sharp';
import { argValue, ScriptClient, sleep } from './http.js';

// `pnpm gate1 --url https://<service>.onrender.com`: Gate 1. Opens a Judge claimant session paid to the
// sandbox personal account, starts a claim, uploads a small JPEG, has the manager approve the held claim,
// then polls until the claim is paid or has a payout issue (5 minutes).
const base = (argValue('url') ?? 'http://localhost:3000').replace(/\/$/, '');
const receiver = readProcessVar('DEMO_CLAIMANT_PAYPAL_EMAIL');
const managerEmail = readProcessVar('DEMO_MANAGER_EMAIL') ?? 'manager@bountyline.demo';
const managerPassword = readProcessVar('DEMO_MANAGER_PASSWORD');
if (!receiver || !managerPassword) {
  process.stderr.write('Set DEMO_CLAIMANT_PAYPAL_EMAIL and DEMO_MANAGER_PASSWORD in .env first.\n');
  process.exit(1);
}

const claimant = new ScriptClient(base);
// Judge deployments close registration, so Gate 1 uses a Judge claimant session, which is paid to
// DEMO_CLAIMANT_PAYPAL_EMAIL (the sandbox personal account) like any judge claim.
const session = await claimant.call('POST', '/api/v1/judge/session', { as: 'claimant' });
if (session.status !== 200) throw new Error(`judge session failed: ${session.status}`);
const start = await claimant.call('POST', '/api/v1/claims', { programId: 'columbia-pikeminnow' });
const claim = start.json.claim as { id: string; code: string };
process.stdout.write(`claim ${claim.id} code ${claim.code}\n`);

const jpeg = await sharp({
  create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 90, b: 120 } },
})
  .jpeg()
  .toBuffer();
const form = new FormData();
form.set(
  'meta',
  JSON.stringify({
    lat: 46.2205,
    lng: -119.1725,
    accuracyM: 10,
    capturedAt: new Date().toISOString(),
    declaredLengthCm: 30,
  }),
);
form.set('photo', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'gate1.jpg');
const ev = await claimant.call('POST', `/api/v1/claims/${claim.id}/evidence`, form);
if (ev.status !== 202) throw new Error(`evidence failed: ${ev.status} ${JSON.stringify(ev.json)}`);

// A plain-colour photo can't pass the checks, so the claim is held; the manager clears it.
let status = 'checking';
for (let i = 0; i < 30 && status === 'checking'; i += 1) {
  await sleep(2000);
  status = String(
    ((await claimant.call('GET', `/api/v1/claims/${claim.id}`)).json.claim as { status: string })
      .status,
  );
}
process.stdout.write(`after checks: ${status}\n`);
const manager = new ScriptClient(base);
const login = await manager.call('POST', '/api/v1/auth/login', {
  email: managerEmail,
  password: managerPassword,
});
if (login.status !== 200) throw new Error(`manager login failed: ${login.status}`);
if (status === 'held') {
  const d = await manager.call('POST', `/api/v1/desk/claims/${claim.id}/decision`, {
    decision: 'approve',
    note: 'Gate 1 test payout',
  });
  process.stdout.write(
    `manager decision: ${d.status} ${String((d.json.claim as { status?: string } | undefined)?.status)}\n`,
  );
}
const deadline = Date.now() + 5 * 60_000;
while (Date.now() < deadline) {
  const got = (await claimant.call('GET', `/api/v1/claims/${claim.id}`)).json.claim as {
    status: string;
    payout?: { status: string; paypalItemId?: string };
  };
  process.stdout.write(
    `${new Date().toISOString()} ${got.status} payout=${got.payout?.status ?? '-'}\n`,
  );
  if (got.status === 'paid' || got.status === 'payout_issue') {
    process.stdout.write(
      got.status === 'paid'
        ? `GATE 1: paid (item ${got.payout?.paypalItemId ?? '?'}). Check the sandbox personal account.\n`
        : 'GATE 1: payout_issue. Read the desk for the PayPal error.\n',
    );
    process.exit(got.status === 'paid' ? 0 : 1);
  }
  await sleep(5000);
}
process.stderr.write('GATE 1: timed out after 5 minutes.\n');
process.exit(1);
