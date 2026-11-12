import { runClaimChecks } from '@bountyline/checks';
import { listLog, poolBalance } from '@bountyline/db';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireCodesOnce, resumeStuckChecksOnce } from '../src/jobs.js';
import { chooseCheckRunner } from '../src/production.js';
import { InlineCheckRunner, RenderWorkflowsCheckRunner } from '../src/runners.js';
import { seed } from '../src/seed.js';
import { ingestPhoto } from '@bountyline/checks';
import { syntheticPhoto } from '../../../packages/checks/test/photos.js';
import {
  Client,
  MANAGER,
  ORIGIN,
  createHarness,
  evidencePayload,
  findings,
  judgeClaimant,
  managerClient,
  type ClaimJson,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('SSE stream', () => {
  it('sends the claim as `event: claim` and closes after a final state', async () => {
    const c = await judgeClaimant(h.app);
    const claim = (await c.post('/api/v1/judge/scenarios/wrong-species/run')).json()
      .claim as ClaimJson;
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = h.app.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/claims/${claim.id}/stream`, {
      headers: { cookie: c.sessionCookie },
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body?.getReader();
    let text = '';
    const deadline = Date.now() + 10_000;
    while (reader && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('event: claim');
    const data = JSON.parse(text.split('data: ')[1]?.split('\n')[0] ?? '{}') as ClaimJson;
    expect(data).toMatchObject({ id: claim.id, status: 'rejected' });
  }, 20_000);

  it('refuses a stream for someone else’s claim', async () => {
    const owner = await judgeClaimant(h.app);
    const claim = (await owner.post('/api/v1/judge/scenarios/undersized/run')).json()
      .claim as ClaimJson;
    const other = await judgeClaimant(h.app);
    expect((await other.get(`/api/v1/claims/${claim.id}/stream`)).status).toBe(404);
  });
});

describe('check runners', () => {
  it('chooses inline when CHECK_RUNNER=render but RENDER_API_KEY is missing, and Render when it is set', () => {
    const checkDeps = {
      db: h.db.db,
      vision: h.vision,
      programs: h.deps.programs,
      clock: h.clock,
      judgeMode: true,
    };
    const base = { ...h.deps.config, CHECK_RUNNER: 'render' as const };
    expect(
      chooseCheckRunner({ ...base, RENDER_API_KEY: undefined }, checkDeps, h.app.log).name,
    ).toBe('inline');
    expect(
      chooseCheckRunner(
        { ...base, RENDER_API_KEY: 'rnd_test_placeholder_key' },
        checkDeps,
        h.app.log,
      ).name,
    ).toBe('render');
    expect(chooseCheckRunner({ ...base, CHECK_RUNNER: 'inline' }, checkDeps, h.app.log).name).toBe(
      'inline',
    );
  });

  it('falls back to inline checks when Render refuses the start', async () => {
    const c = await judgeClaimant(h.app);
    // Start a claim without running checks: swap in a runner that does nothing, then restore.
    const real = h.deps.checkRunner;
    h.deps.checkRunner = { name: 'inline', start: async () => undefined };
    const claim = (await c.post('/api/v1/judge/scenarios/pike-clean/run')).json()
      .claim as ClaimJson;
    h.deps.checkRunner = real;
    expect(claim.status).toBe('checking');
    const checkDeps = {
      db: h.db.db,
      vision: h.vision,
      programs: h.deps.programs,
      clock: h.clock,
      judgeMode: true,
    };
    const inline = new InlineCheckRunner(checkDeps, h.app.log, true);
    const render = new RenderWorkflowsCheckRunner(
      'rnd_invalid_test_key',
      'bountyline-checks/runClaimChecks',
      inline,
      checkDeps,
      h.app.log,
    );
    // Replace the SDK client with one that refuses, so the test needs no network.
    Object.assign(render as unknown as { render: unknown }, {
      render: {
        workflows: {
          startTask: async () => {
            throw new Error('refused');
          },
        },
      },
    });
    await render.start(claim.id);
    expect(((await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson).status).toBe(
      'approved',
    );
  });

  it('decides a claim once even if checks run twice (Workflows retries)', async () => {
    const c = await judgeClaimant(h.app);
    const claim = (await c.post('/api/v1/judge/scenarios/pike-clean/run')).json()
      .claim as ClaimJson;
    const again = await runClaimChecks(
      { db: h.db.db, vision: h.vision, programs: h.deps.programs, clock: h.clock, judgeMode: true },
      claim.id,
    );
    expect(again).toMatchObject({ status: 'skipped' });
    expect((await listLog(h.db.db, claim.id)).filter((r) => r.action === 'decided')).toHaveLength(
      1,
    );
  });
});

describe('budget guard through the API', () => {
  it('holds a clean app claim with pool_insufficient when the pool is empty', async () => {
    const empty = await createHarness({ seedDb: false, env: { JUDGE_MODE: 'false' } });
    try {
      const c = new Client(empty.app);
      await c.post('/api/v1/auth/register', {
        email: 'b@example.com',
        displayName: 'B',
        password: 'a-long-password',
        paypalEmail: 'b@example.com',
        ageAttested: true,
      });
      const claim = (await c.post('/api/v1/claims', { programId: 'lake-roosevelt-pike' })).json()
        .claim as ClaimJson;
      const photo = await syntheticPhoto(777);
      empty.vision.set(
        (await ingestPhoto(photo)).sha256,
        findings({
          species: { key: 'northern_pike', commonName: 'Northern pike', confidence: 0.95 },
          code: { visible: true, text: claim.code, confidence: 0.9 },
        }),
      );
      const { body, headers } = evidencePayload(photo, {
        lat: 48.6,
        lng: -118.1,
        accuracyM: 5,
        capturedAt: '2026-11-11T17:59:00Z',
      });
      await empty.app.inject({
        method: 'POST',
        url: `/api/v1/claims/${claim.id}/evidence`,
        headers: { ...headers, origin: ORIGIN, cookie: c.sessionCookie },
        payload: body,
      });
      const after = (await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson;
      expect(after.status).toBe('held');
      expect(after.reasons.map((r) => r.code)).toEqual(['pool_insufficient']);
      expect((await poolBalance(empty.db.db, 'lake-roosevelt-pike')).available.amountMinor).toBe(0);
    } finally {
      await empty.close();
    }
  });

  it('tops up a Judge pool that runs low, and only for Judge claims', async () => {
    const c = await judgeClaimant(h.app);
    const run = await c.post('/api/v1/judge/scenarios/pike-clean/run');
    const id = (run.json().claim as ClaimJson).id;
    // The run answers 201 with the claim as it was when evidence landed (`checking`); read it again.
    expect(((await c.get(`/api/v1/claims/${id}`)).json().claim as ClaimJson).status).toBe(
      'approved',
    );
    expect(
      (await poolBalance(h.db.db, 'lake-roosevelt-pike')).available.amountMinor,
    ).toBeGreaterThan(10_000);
  });
});

describe('jobs and seed', () => {
  it('resumes a claim left in checking by a crash', async () => {
    const c = await judgeClaimant(h.app);
    const real = h.deps.checkRunner;
    h.deps.checkRunner = { name: 'inline', start: async () => undefined };
    const claim = (await c.post('/api/v1/judge/scenarios/pike-clean/run')).json()
      .claim as ClaimJson;
    h.deps.checkRunner = real;
    h.clock.advance(5 * 60_000 + 1);
    expect(await resumeStuckChecksOnce(h.deps)).toBeGreaterThanOrEqual(1);
    expect(((await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson).status).toBe(
      'approved',
    );
  });

  it('rejects an unknown status filter with 400 instead of a database error', async () => {
    const m = await managerClient(h.app);
    expect((await m.get('/api/v1/desk/claims?status=held,bogus')).status).toBe(400);
    expect((await m.get('/api/v1/desk/claims?status=held,payout_issue')).status).toBe(200);
  });

  it('expires a claim whose code ran out before evidence arrived', async () => {
    const c = await judgeClaimant(h.app);
    const start = await c.post('/api/v1/claims', { programId: 'columbia-pikeminnow' });
    const claim = start.json().claim as ClaimJson;
    h.clock.advance(16 * 60_000);
    expect(await expireCodesOnce(h.deps)).toBeGreaterThanOrEqual(1);
    expect(((await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson).status).toBe(
      'expired',
    );
  });

  it('is idempotent: a second seed changes nothing', async () => {
    const report = await seed({
      db: h.db.db,
      programs: h.deps.programs,
      scenarios: h.deps.scenarios,
      photosDir: h.deps.photosDir,
      clock: h.clock,
      ids: h.deps.ids,
      manager: MANAGER,
    });
    expect(report).toEqual({ manager: 'exists', funded: [], history: [], warnings: [] });
  });

  it('lets a Judge session log in as the demo manager', async () => {
    const m = await managerClient(h.app);
    const res = await m.post('/api/v1/judge/session', { as: 'manager' });
    expect((res.json().user as { role: string }).role).toBe('manager');
  });
});
