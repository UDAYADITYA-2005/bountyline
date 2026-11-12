import { money } from '@bountyline/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/client.js';
import { patchClaim, transitionClaim } from '../src/repos/claims.js';
import { getGeminiUsage, incrementGeminiUsage } from '../src/repos/checks.js';
import { reserve, receiverReservedSince } from '../src/repos/ledger.js';
import {
  claimDueJobs,
  enqueuePayout,
  getPayoutJob,
  listStaleSent,
  markJob,
  requeueForRetry,
  requeueStuckSending,
} from '../src/repos/payouts.js';
import { findDuplicateCandidates, insertPhoto } from '../src/repos/photos.js';
import { insertWebhookEventIfNew } from '../src/repos/webhooks.js';
import { createTestDb } from '../src/test-db.js';
import { SYSTEM } from '../src/types.js';
import { NOW, makeClaim, nextId, seedBasics } from './builders.js';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

async function photo(phash: bigint, sha = nextId('S')) {
  return insertPhoto(h.db, {
    id: nextId('P'),
    sha256: sha,
    phash,
    dhash: 0n,
    mime: 'image/jpeg',
    width: 10,
    height: 10,
    bytes: new Uint8Array([1, 2, 3]),
    createdAt: NOW,
  });
}

describe('duplicate search', () => {
  it('ranks prior claims by pHash Hamming distance and flags the same SHA-256', async () => {
    const { user } = await seedBasics(h.db);
    const base = 0x0f0f_0f0f_0f0f_0f0fn;
    const a = await photo(base, 'same-sha');
    const b = await photo(base ^ 0b111111n); // distance 6
    await makeClaim(h.db, user.id, { photoId: a.id });
    await makeClaim(h.db, user.id, { photoId: b.id });
    const current = await makeClaim(h.db, user.id);
    const found = await findDuplicateCandidates(h.db, {
      claimId: current.id,
      sha256: 'same-sha',
      phash: base,
      judgeSessionId: null,
    });
    expect(found.slice(0, 2).map((f) => [f.distance, f.sameSha])).toEqual([
      [0, true],
      [6, false],
    ]);
  });

  it('keeps judge sessions apart but lets them see the seeded history', async () => {
    const { user } = await seedBasics(h.db);
    const hash = 0x7777_0000_1234_5678n;
    const seeded = await photo(hash);
    const other = await photo(hash);
    await makeClaim(h.db, user.id, {
      photoId: seeded.id,
      source: 'judge_scenario',
      judgeSessionId: null,
    });
    await makeClaim(h.db, user.id, {
      photoId: other.id,
      source: 'judge_scenario',
      judgeSessionId: 'other',
    });
    const mine = await makeClaim(h.db, user.id, {
      source: 'judge_scenario',
      judgeSessionId: 'mine',
    });
    const found = await findDuplicateCandidates(h.db, {
      claimId: mine.id,
      sha256: 'x',
      phash: hash,
      judgeSessionId: 'mine',
    });
    expect(found.filter((f) => f.distance === 0).map((f) => f.photoId)).toEqual([seeded.id]);
  });
});

describe('payout jobs', () => {
  async function approvedWithJob() {
    const { user } = await seedBasics(h.db);
    const claim = await makeClaim(h.db, user.id, { status: 'checking' });
    await h.db.transaction(async (tx) => {
      await transitionClaim(tx, {
        claimId: claim.id,
        event: 'decide_approve',
        now: NOW,
        actor: SYSTEM,
        action: 'decided',
        patch: { amountMinor: 600 },
      });
      await reserve(tx, {
        programId: claim.programId,
        claimId: claim.id,
        amount: money(600),
        source: 'decision',
        now: NOW,
      });
      await enqueuePayout(tx, {
        claimId: claim.id,
        receiver: 'r@example.com',
        receiverKey: 'r@example.com',
        amountMinor: 600,
        now: NOW,
      });
    });
    return claim;
  }

  it('claims a due job once, then nothing until it is requeued', async () => {
    const claim = await approvedWithJob();
    const first = await h.db.transaction((tx) => claimDueJobs(tx, NOW));
    expect(first.map((j) => [j.claimId, j.status, j.senderBatchId])).toContainEqual([
      claim.id,
      'sending',
      claim.id,
    ]);
    const second = await h.db.transaction((tx) => claimDueJobs(tx, NOW));
    expect(second.find((j) => j.claimId === claim.id)).toBeUndefined();
    const later = new Date(NOW.getTime() + 3 * 60_000);
    expect(
      await requeueStuckSending(h.db, new Date(later.getTime() - 120_000), later),
    ).toBeGreaterThan(0);
    expect((await getPayoutJob(h.db, claim.id))?.status).toBe('queued');
  });

  it('uses claimId-r1 after a manager retry', async () => {
    const claim = await approvedWithJob();
    const job = await h.db.transaction((tx) => requeueForRetry(tx, claim.id, NOW));
    expect(job.senderBatchId).toBe(`${claim.id}-r1`);
    expect(job.attempt).toBe(1);
  });

  it('finds sent jobs that no webhook resolved', async () => {
    const claim = await approvedWithJob();
    await markJob(h.db, claim.id, { status: 'sent', paypalBatchId: 'B1', updatedAt: NOW });
    const stale = await listStaleSent(h.db, new Date(NOW.getTime() + 1));
    expect(stale.map((j) => j.claimId)).toContain(claim.id);
  });

  it('sums today’s reservations per receiver', async () => {
    await approvedWithJob();
    const total = await receiverReservedSince(h.db, {
      receiverKey: 'r@example.com',
      since: new Date(NOW.getTime() - 1),
    });
    expect(total.amountMinor).toBeGreaterThanOrEqual(600);
  });
});

describe('webhook events and usage', () => {
  it('stores an event once and reports a replay', async () => {
    const event = {
      id: 'WH-1',
      eventType: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
      resourceId: 'I1',
      payload: {},
      receivedAt: NOW,
    };
    expect(await insertWebhookEventIfNew(h.db, event)).toBe(true);
    expect(await insertWebhookEventIfNew(h.db, event)).toBe(false);
  });

  it('counts Gemini requests per day atomically', async () => {
    expect(await incrementGeminiUsage(h.db, '2026-11-11')).toBe(1);
    expect(await incrementGeminiUsage(h.db, '2026-11-11')).toBe(2);
    expect(await getGeminiUsage(h.db, '2026-11-12')).toBe(0);
  });

  it('patches non-status fields', async () => {
    const { user } = await seedBasics(h.db);
    const claim = await makeClaim(h.db, user.id);
    await patchClaim(h.db, claim.id, { lat: 46.2 }, NOW);
  });
});
