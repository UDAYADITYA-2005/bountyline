import { cleanFindings } from '@bountyline/checks';
import { listWebhookEvents, poolBalance } from '@bountyline/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemEvent, signWebhook } from '../../../packages/paypal/test/sign.js';
import {
  RECEIVER,
  createHarness,
  judgeClaimant,
  managerClient,
  runScenario,
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

/** The dispatcher sends five jobs per tick; run it until the queue is empty. */
async function drain(): Promise<number> {
  let total = 0;
  for (
    let n = await h.services.payouts.dispatchOnce();
    n > 0;
    n = await h.services.payouts.dispatchOnce()
  )
    total += n;
  return total;
}

async function deliver(event: unknown) {
  const signed = signWebhook(event);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/paypal/webhook',
    headers: { ...signed.headers, 'content-type': 'application/json' },
    payload: signed.rawBody,
  });
}

describe('Judge mode scenarios with the real rules (vision faked)', () => {
  it('lists the scenario pack with photo URLs and real-code flags', async () => {
    const c = await judgeClaimant(h.app);
    const res = await c.get('/api/v1/judge/scenarios');
    const scenarios = res.json().scenarios as { id: string; photoUrl: string; realCode: boolean }[];
    expect(scenarios.map((s) => s.id)).toEqual([
      'clean-pikeminnow',
      'clean-pikeminnow-2',
      'reused-photo',
      'out-of-area',
      'wrong-species',
      'undersized',
      'pike-clean',
    ]);
    expect(scenarios[0]?.realCode).toBe(false);
    expect((await c.get(scenarios[0]?.photoUrl ?? '')).raw.headers['content-type']).toBe(
      'image/jpeg',
    );
  });

  it.each([
    ['clean-pikeminnow', 'approved', 600, []],
    ['reused-photo', 'rejected', undefined, ['duplicate_exact']],
    ['out-of-area', 'held', undefined, ['outside_area']],
    ['wrong-species', 'rejected', undefined, ['wrong_species']],
    ['undersized', 'rejected', undefined, ['below_min_length']],
    ['pike-clean', 'approved', 1000, []],
  ])('%s ends %s', async (id, status, amount, reasons) => {
    const c = await judgeClaimant(h.app);
    const claim = await runScenario(c, id);
    expect(claim.status).toBe(status);
    expect(claim.amount?.amountMinor).toBe(amount);
    expect(claim.reasons.map((r) => r.code)).toEqual(reasons);
    expect(claim.checks.find((x) => x.key === 'code_in_frame')).toMatchObject({
      status: 'skipped',
      detail: 'skipped (sample photo)',
    });
  });

  it('pays the two clean pikeminnow at the first tier, counted per claimant', async () => {
    const c = await judgeClaimant(h.app);
    const first = await runScenario(c, 'clean-pikeminnow');
    const second = await runScenario(c, 'clean-pikeminnow-2');
    expect([first.amount?.formatted, second.amount?.formatted]).toEqual(['$6.00', '$6.00']);
  });

  it('keeps judge sessions apart: another session can reuse a scenario photo', async () => {
    const a = await judgeClaimant(h.app);
    const b = await judgeClaimant(h.app);
    expect((await runScenario(a, 'pike-clean')).status).toBe('approved');
    expect((await runScenario(b, 'pike-clean')).status).toBe('approved');
    // ...but the same session using the same photo twice is caught.
    expect((await runScenario(a, 'pike-clean')).reasons.map((r) => r.code)).toContain(
      'duplicate_exact',
    );
  });

  it('runs the full money path: approve, dispatch to PayPal, webhook marks paid', async () => {
    const c = await judgeClaimant(h.app);
    const claim = await runScenario(c, 'clean-pikeminnow');
    expect(await drain()).toBeGreaterThan(0);
    const req = h.gateway.created.find((r) => r.claimId === claim.id);
    expect(req).toMatchObject({
      claimId: claim.id,
      attempt: 0,
      receiver: RECEIVER,
      amount: { amountMinor: 600, currency: 'USD' },
    });
    expect(((await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson).status).toBe(
      'paying',
    );
    const res = await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id));
    expect(res.statusCode).toBe(200);
    const paid = (await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson;
    expect(paid.status).toBe('paid');
    expect(
      (await listWebhookEvents(h.db.db)).some((e) => e.resourceId === `ITEM-${claim.id}`),
    ).toBe(true);
  });

  it('lets the manager clear a held claim from the desk, which then pays', async () => {
    const c = await judgeClaimant(h.app);
    const held = await runScenario(c, 'out-of-area');
    const m = await managerClient(h.app);
    const queue = await m.get('/api/v1/desk/claims?status=held,payout_issue');
    expect((queue.json().claims as ClaimJson[]).map((x) => x.id)).toContain(held.id);
    const decided = await m.post(`/api/v1/desk/claims/${held.id}/decision`, {
      decision: 'approve',
      note: 'Angler confirmed launch site',
    });
    expect(decided.status).toBe(200);
    expect(decided.json().claim as ClaimJson).toMatchObject({
      status: 'approved',
      amount: { amountMinor: 600 },
    });
    await drain();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', held.id));
    const detail = await m.get(`/api/v1/desk/claims/${held.id}`);
    expect((detail.json().claim as ClaimJson).status).toBe('paid');
    const actions = (detail.json().history as { action: string; actorType: string }[]).map(
      (x) => x.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'created',
        'evidence_submitted',
        'decided',
        'manager_decision',
        'payout_sent',
        'paid',
      ]),
    );
    expect((detail.json().claim as ClaimJson).location?.lat).toBe(47.6062);
  });

  it('refuses a desk decision on a claim that is not held', async () => {
    const c = await judgeClaimant(h.app);
    const approved = await runScenario(c, 'pike-clean');
    const m = await managerClient(h.app);
    const res = await m.post(`/api/v1/desk/claims/${approved.id}/decision`, {
      decision: 'reject',
      note: 'no',
    });
    expect(res.status).toBe(409);
    expect(res.json().code).toBe('INVALID_STATE');
  });

  it('rejects a held claim without touching the pool', async () => {
    const c = await judgeClaimant(h.app);
    const held = await runScenario(c, 'out-of-area');
    const before = await poolBalance(h.db.db, 'columbia-pikeminnow');
    const m = await managerClient(h.app);
    const res = await m.post(`/api/v1/desk/claims/${held.id}/decision`, {
      decision: 'reject',
      note: 'Seattle is not on the river',
    });
    expect((res.json().claim as ClaimJson).status).toBe('rejected');
    expect((await poolBalance(h.db.db, 'columbia-pikeminnow')).available).toEqual(before.available);
  });

  it('holds with ai_unavailable when the photo check is unavailable', async () => {
    h.vision.set(h.photoSha.get('pikeminnow-03.jpg') ?? '', 'unavailable');
    const c = await judgeClaimant(h.app);
    const claim = await runScenario(c, 'clean-pikeminnow-2');
    expect(claim.status).toBe('held');
    expect(claim.reasons.map((r) => r.code)).toContain('ai_unavailable');
    h.vision.set(h.photoSha.get('pikeminnow-03.jpg') ?? '', cleanFindings());
  });

  it('serves the desk tables and the pool', async () => {
    const m = await managerClient(h.app);
    for (const table of ['claims', 'payouts', 'ledger', 'audits']) {
      const res = await m.get(`/api/v1/desk/data/${table}`);
      expect(res.status, table).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    }
    const claims = (await m.get('/api/v1/desk/data/claims')).json().data as Record<
      string,
      unknown
    >[];
    expect(Object.keys(claims[0] ?? {})).toEqual(
      expect.arrayContaining([
        'id',
        'program',
        'claimant',
        'species',
        'lengthCm',
        'status',
        'decision',
        'amountUsd',
        'submittedAt',
        'lat',
        'lng',
        'holdReasons',
        'audit',
      ]),
    );
    const pools = (await m.get('/api/v1/desk/pool')).json().pools as {
      programId: string;
      available: { amountMinor: number };
    }[];
    expect(pools.map((p) => p.programId).sort()).toEqual([
      'columbia-pikeminnow',
      'lake-roosevelt-pike',
    ]);
  });

  it('requests and resolves a hand-in audit on a paid claim', async () => {
    const c = await judgeClaimant(h.app);
    const claim = await runScenario(c, 'pike-clean');
    await drain();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id));
    const m = await managerClient(h.app);
    const current = (await m.get(`/api/v1/desk/claims/${claim.id}`)).json().claim as ClaimJson;
    if (current.audit === 'none') {
      expect(
        (await m.post(`/api/v1/desk/claims/${claim.id}/audit`, { action: 'request' })).json().claim,
      ).toMatchObject({ audit: 'requested' });
    }
    expect(
      (
        await m.post(`/api/v1/desk/claims/${claim.id}/audit`, {
          action: 'pass',
          note: 'Head handed in',
        })
      ).json().claim,
    ).toMatchObject({ audit: 'passed' });
    expect((await m.post(`/api/v1/desk/claims/${claim.id}/audit`, { action: 'pass' })).status).toBe(
      409,
    );
  });
});

describe('reason list', () => {
  it('shows ai_unavailable once even when several vision checks are unavailable', async () => {
    h.vision.set(h.photoSha.get('pikeminnow-05.jpg') ?? '', 'unavailable');
    const c = await judgeClaimant(h.app);
    const claim = await runScenario(c, 'undersized');
    expect(claim.reasons.filter((r) => r.code === 'ai_unavailable')).toHaveLength(1);
    h.vision.set(h.photoSha.get('pikeminnow-05.jpg') ?? '', cleanFindings());
  });
});
