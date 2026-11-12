import { getPayoutJob, getReservation, listLog, markJob, poolBalance } from '@bountyline/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemEvent, signWebhook } from '../../../packages/paypal/test/sign.js';
import { duplicateBatch, serverError, validationError } from './fakes.js';
import {
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

async function approvedClaim(): Promise<ClaimJson> {
  const c = await judgeClaimant(h.app);
  const claim = await runScenario(c, 'pike-clean');
  expect(claim.status).toBe('approved');
  return claim;
}

async function drain(): Promise<void> {
  while ((await h.services.payouts.dispatchOnce()) > 0) {
    /* keep sending */
  }
}

async function status(id: string): Promise<string> {
  const m = await managerClient(h.app);
  return ((await m.get(`/api/v1/desk/claims/${id}`)).json().claim as ClaimJson).status;
}

function deliver(
  event: unknown,
  opts: Parameters<typeof signWebhook>[1] = {},
  tamper?: (b: Buffer) => Buffer,
) {
  const signed = signWebhook(event, opts);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/paypal/webhook',
    headers: { ...signed.headers, 'content-type': 'application/json' },
    payload: tamper ? tamper(signed.rawBody) : signed.rawBody,
  });
}

describe('payout dispatcher', () => {
  it('retries a 5xx with the same sender_batch_id, then sends', async () => {
    await drain();
    const claim = await approvedClaim();
    h.gateway.onCreate(serverError());
    await h.services.payouts.dispatchOnce();
    let job = await getPayoutJob(h.db.db, claim.id);
    expect(job).toMatchObject({
      status: 'queued',
      tries: 1,
      senderBatchId: claim.id,
      lastError: 'Server',
    });
    expect(await status(claim.id)).toBe('approved');
    h.clock.advance(2_001);
    await drain();
    job = await getPayoutJob(h.db.db, claim.id);
    expect(job?.status).toBe('sent');
    const sends = h.gateway.created.filter((r) => r.claimId === claim.id);
    expect(sends.map((r) => r.attempt)).toEqual([0, 0]);
    expect(await status(claim.id)).toBe('paying');
  });

  it('treats a duplicate sender_batch_id as already sent', async () => {
    await drain();
    const claim = await approvedClaim();
    h.gateway.onCreate(duplicateBatch('EXISTING1'));
    await h.services.payouts.dispatchOnce();
    expect(await getPayoutJob(h.db.db, claim.id)).toMatchObject({
      status: 'sent',
      paypalBatchId: 'EXISTING1',
    });
    expect(await status(claim.id)).toBe('paying');
  });

  it('moves a claim to payout_issue on a final 4xx, keeps the reservation, and a manager retry uses -r1', async () => {
    await drain();
    const claim = await approvedClaim();
    h.gateway.onCreate(validationError());
    await h.services.payouts.dispatchOnce();
    expect(await getPayoutJob(h.db.db, claim.id)).toMatchObject({
      status: 'failed',
      lastError: 'RECEIVER_UNREGISTERED',
    });
    expect(await status(claim.id)).toBe('payout_issue');
    expect(await getReservation(h.db.db, claim.id)).toEqual({ amountMinor: 1000, currency: 'USD' });

    const m = await managerClient(h.app);
    const res = await m.post(`/api/v1/desk/claims/${claim.id}/decision`, {
      decision: 'approve',
      note: 'Receiver fixed their account',
    });
    expect((res.json().claim as ClaimJson).status).toBe('approved');
    expect(await getPayoutJob(h.db.db, claim.id)).toMatchObject({
      status: 'queued',
      attempt: 1,
      senderBatchId: `${claim.id}-r1`,
    });
    await drain();
    expect(h.gateway.created.filter((r) => r.claimId === claim.id).map((r) => r.attempt)).toEqual([
      0, 1,
    ]);
  });

  it('releases the reservation when a manager rejects a payout issue', async () => {
    await drain();
    const claim = await approvedClaim();
    h.gateway.onCreate(validationError());
    await h.services.payouts.dispatchOnce();
    const before = (await poolBalance(h.db.db, 'lake-roosevelt-pike')).available.amountMinor;
    const m = await managerClient(h.app);
    await m.post(`/api/v1/desk/claims/${claim.id}/decision`, {
      decision: 'reject',
      note: 'Could not reach the angler',
    });
    expect(await status(claim.id)).toBe('rejected');
    expect((await poolBalance(h.db.db, 'lake-roosevelt-pike')).available.amountMinor).toBe(
      before + 1000,
    );
  });

  it('recovers a job stuck in sending after a crash, with the same ID', async () => {
    await drain();
    const claim = await approvedClaim();
    await markJob(h.db.db, claim.id, { status: 'sending', updatedAt: h.clock.now() });
    h.clock.advance(2 * 60_000 + 1);
    await h.services.payouts.reconcileOnce();
    expect((await getPayoutJob(h.db.db, claim.id))?.status).toBe('queued');
    await drain();
    expect(h.gateway.created.filter((r) => r.claimId === claim.id)).toHaveLength(1);
    expect((await getPayoutJob(h.db.db, claim.id))?.senderBatchId).toBe(claim.id);
  });
});

describe('webhook', () => {
  async function paying(): Promise<ClaimJson> {
    await drain();
    const claim = await approvedClaim();
    await drain();
    expect(await status(claim.id)).toBe('paying');
    return claim;
  }

  it('rejects a tampered body with 400 and changes nothing', async () => {
    const claim = await paying();
    const res = await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id), {}, (b) =>
      Buffer.from(b.toString().replace('SUCCEEDED"', 'SUCCEEDED" ')),
    );
    expect(res.statusCode).toBe(400);
    expect(await status(claim.id)).toBe('paying');
  });

  it('rejects a cert from outside paypal.com and a wrong webhook ID', async () => {
    const claim = await paying();
    expect(
      (
        await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id), {
          certUrl: 'https://evil.example.com/c.pem',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id), {
          webhookId: 'WH-SOMEONE-ELSE',
        })
      ).statusCode,
    ).toBe(400);
    expect(await status(claim.id)).toBe('paying');
  });

  it('stores a replay once and applies it once', async () => {
    const claim = await paying();
    const event = itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id);
    expect((await deliver(event)).json()).toEqual({ received: true, replay: false });
    expect((await deliver(event)).json()).toEqual({ received: true, replay: true });
    const paidRows = (await listLog(h.db.db, claim.id)).filter((r) => r.action === 'paid');
    expect(paidRows).toHaveLength(1);
  });

  it('never moves a paid claim backwards on a late FAILED', async () => {
    const claim = await paying();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id));
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.FAILED', claim.id));
    expect(await status(claim.id)).toBe('paid');
    expect((await getPayoutJob(h.db.db, claim.id))?.status).toBe('succeeded');
  });

  it('accepts SUCCEEDED after UNCLAIMED: PayPal saying money moved wins', async () => {
    const claim = await paying();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.UNCLAIMED', claim.id));
    expect(await status(claim.id)).toBe('payout_issue');
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id));
    expect(await status(claim.id)).toBe('paid');
  });

  it('keeps a PayPal-held item in paying and shows it on the job', async () => {
    const claim = await paying();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.HELD', claim.id));
    expect(await status(claim.id)).toBe('paying');
    expect((await getPayoutJob(h.db.db, claim.id))?.lastError).toBe('HELD_BY_PAYPAL');
  });

  it('acknowledges unknown events and events for claims we never paid', async () => {
    expect(
      (
        await deliver({
          id: 'WH-OTHER-1',
          event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
          resource: { batch_header: { payout_batch_id: 'X' } },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', 'NOT-A-CLAIM'))).statusCode,
    ).toBe(200);
  });
});

describe('review fixes (payments-reviewer B1, B2)', () => {
  it('refuses a manager retry or reject while PayPal holds an UNCLAIMED payout', async () => {
    await drain();
    const claim = await approvedClaim();
    await drain();
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.UNCLAIMED', claim.id));
    expect(await status(claim.id)).toBe('payout_issue');
    const m = await managerClient(h.app);
    for (const decision of ['approve', 'reject']) {
      const res = await m.post(`/api/v1/desk/claims/${claim.id}/decision`, {
        decision,
        note: 'try',
      });
      expect([res.status, res.json().code]).toEqual([409, 'INVALID_STATE']);
    }
    // Once PayPal returns the money, the manager may act.
    await deliver(itemEvent('PAYMENT.PAYOUTS-ITEM.RETURNED', claim.id, `WH-RET-${claim.id}`));
    const ok = await m.post(`/api/v1/desk/claims/${claim.id}/decision`, {
      decision: 'approve',
      note: 'Receiver opened an account',
    });
    expect((ok.json().claim as ClaimJson).status).toBe('approved');
  });

  it('ignores a late event from an older attempt after a manager retry', async () => {
    await drain();
    const claim = await approvedClaim();
    h.gateway.onCreate(validationError());
    await h.services.payouts.dispatchOnce();
    const m = await managerClient(h.app);
    await m.post(`/api/v1/desk/claims/${claim.id}/decision`, {
      decision: 'approve',
      note: 'retry',
    });
    await drain();
    expect((await getPayoutJob(h.db.db, claim.id))?.paypalBatchId).toBe(`BATCH-${claim.id}-r1`);
    // A late FAILED for the first attempt's batch must not touch attempt 1.
    const stale = itemEvent('PAYMENT.PAYOUTS-ITEM.FAILED', claim.id, `WH-STALE-${claim.id}`);
    stale.resource.payout_batch_id = `BATCH-OLD-${claim.id}`;
    await deliver(stale);
    expect(await status(claim.id)).toBe('paying');
    const fresh = itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', claim.id, `WH-OK-${claim.id}`);
    fresh.resource.payout_batch_id = `BATCH-${claim.id}-r1`;
    await deliver(fresh);
    expect(await status(claim.id)).toBe('paid');
  });
});

describe('reconciler', () => {
  it('never applies another claim’s item from the same batch', async () => {
    await drain();
    const claim = await approvedClaim();
    await drain();
    const job = await getPayoutJob(h.db.db, claim.id);
    h.gateway.setBatch({
      payoutBatchId: job?.paypalBatchId ?? '',
      batchStatus: 'SUCCESS',
      items: [
        {
          payoutItemId: 'X',
          senderItemId: 'SOMEONE-ELSE',
          transactionStatus: 'SUCCESS',
          outcome: 'succeeded',
        },
      ],
    });
    h.clock.advance(2 * 60_000 + 1);
    for (let i = 0; i < 5; i += 1) await h.services.payouts.reconcileOnce();
    expect(await status(claim.id)).toBe('paying');
  });

  it('resolves a lost webhook by polling the batch', async () => {
    await drain();
    const claim = await approvedClaim();
    await drain();
    const job = await getPayoutJob(h.db.db, claim.id);
    h.gateway.setBatch({
      payoutBatchId: job?.paypalBatchId ?? '',
      batchStatus: 'SUCCESS',
      items: [
        {
          payoutItemId: 'ITEM-R1',
          senderItemId: claim.id,
          transactionStatus: 'SUCCESS',
          outcome: 'succeeded',
        },
      ],
    });
    h.clock.advance(2 * 60_000 + 1);
    // Earlier tests left other jobs in `sent`; poll until ours comes round (20 per pass).
    for (let i = 0; i < 10 && (await status(claim.id)) !== 'paid'; i += 1) {
      await h.services.payouts.reconcileOnce();
    }
    expect(await status(claim.id)).toBe('paid');
    expect((await getPayoutJob(h.db.db, claim.id))?.paypalItemId).toBe('ITEM-R1');
    const via = (await listLog(h.db.db, claim.id)).find((r) => r.action === 'paid')?.data as {
      via?: string;
    };
    expect(via.via).toBe('reconciler');
  });
});
