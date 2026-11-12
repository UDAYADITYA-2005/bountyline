import { ClaimStatus, AuditStatus, CheckKey, PayoutJobStatus } from '@bountyline/contracts';
import { money } from '@bountyline/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/client.js';
import { getClaim, listLog, transitionClaim } from '../src/repos/claims.js';
import { addFunding, poolBalance, release, reserve } from '../src/repos/ledger.js';
import { enqueuePayout } from '../src/repos/payouts.js';
import { lockProgramPool, upsertPrograms } from '../src/repos/programs.js';
import * as schema from '../src/schema.js';
import { createTestDb } from '../src/test-db.js';
import { SYSTEM } from '../src/types.js';
import { NOW, demoPrograms, makeClaim, seedBasics } from './builders.js';

let h: DbHandle;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function failsWith(p: Promise<unknown>, re: RegExp): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(err, 'expected the query to fail').not.toBeNull();
  expect(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`).toMatch(re);
}
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

async function approvedClaim() {
  const { user } = await seedBasics(h.db);
  const claim = await makeClaim(h.db, user.id, { status: 'checking' });
  return h.db.transaction((tx) =>
    transitionClaim(tx, {
      claimId: claim.id,
      event: 'decide_approve',
      now: NOW,
      actor: SYSTEM,
      action: 'decided',
      patch: { amountMinor: 600, decision: 'approve' },
    }),
  );
}

describe('schema enums', () => {
  it('mirror the zod enums in contracts', () => {
    expect(schema.claimStatus.enumValues).toEqual(ClaimStatus.options);
    expect(schema.auditStatus.enumValues).toEqual(AuditStatus.options);
    expect(schema.checkKey.enumValues).toEqual(CheckKey.options);
    expect(schema.payoutJobStatus.enumValues).toEqual(PayoutJobStatus.options);
  });
});

describe('data model invariants', () => {
  it('1a: refuses a second reserve for the same claim', async () => {
    const claim = await approvedClaim();
    await reserve(h.db, {
      programId: claim.programId,
      claimId: claim.id,
      amount: money(600),
      source: 'decision',
      now: NOW,
    });
    await expect(
      reserve(h.db, {
        programId: claim.programId,
        claimId: claim.id,
        amount: money(600),
        source: 'decision',
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  it('1b: refuses a second payout job for the same claim', async () => {
    const claim = await approvedClaim();
    const job = {
      claimId: claim.id,
      receiver: 'a@example.com',
      receiverKey: 'a@example.com',
      amountMinor: 600,
      now: NOW,
    };
    await enqueuePayout(h.db, job);
    await expect(enqueuePayout(h.db, job)).rejects.toThrow();
  });

  it('2: refuses an approved claim without an amount', async () => {
    const { user } = await seedBasics(h.db);
    const claim = await makeClaim(h.db, user.id, { status: 'checking' });
    await expect(
      h.db.transaction((tx) =>
        transitionClaim(tx, {
          claimId: claim.id,
          event: 'decide_approve',
          now: NOW,
          actor: SYSTEM,
          action: 'decided',
        }),
      ),
    ).rejects.toThrow();
  });

  it('4: refuses a release without a reservation, or for a different amount', async () => {
    const claim = await approvedClaim();
    const base = { programId: claim.programId, claimId: claim.id, source: 'manager', now: NOW };
    await expect(release(h.db, { ...base, amount: money(600) })).rejects.toThrow();
    await reserve(h.db, { ...base, amount: money(600) });
    await expect(release(h.db, { ...base, amount: money(500) })).rejects.toThrow();
    await release(h.db, { ...base, amount: money(600) });
    await expect(release(h.db, { ...base, amount: money(600) })).rejects.toThrow();
  });

  it('5: a final state never changes, even with raw SQL', async () => {
    const { user } = await seedBasics(h.db);
    const claim = await makeClaim(h.db, user.id, { status: 'checking' });
    await h.db.transaction((tx) =>
      transitionClaim(tx, {
        claimId: claim.id,
        event: 'decide_reject',
        now: NOW,
        actor: SYSTEM,
        action: 'decided',
      }),
    );
    await failsWith(
      h.db.execute(
        sql`UPDATE claims SET status = 'approved', amount_minor = 600 WHERE id = ${claim.id}`,
      ),
      /final/,
    );
    await expect(
      h.db.transaction((tx) =>
        transitionClaim(tx, {
          claimId: claim.id,
          event: 'manager_approve',
          now: NOW,
          actor: SYSTEM,
          action: 'x',
        }),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect((await getClaim(h.db, claim.id))?.status).toBe('rejected');
  });

  it('6: two concurrent reservations cannot overdraw the pool', async () => {
    await upsertPrograms(h.db, demoPrograms(), NOW);
    const programId = 'lake-roosevelt-pike';
    await addFunding(h.db, { programId, amount: money(1000), source: 'test-6', now: NOW });
    const start = (await poolBalance(h.db, programId)).available.amountMinor;
    const { user } = await seedBasics(h.db);
    const claims = [
      await makeClaim(h.db, user.id, { programId, status: 'checking' }),
      await makeClaim(h.db, user.id, { programId, status: 'checking' }),
    ];
    const want = start; // each claim asks for the whole remaining pool
    const results = await Promise.allSettled(
      claims.map((c) =>
        h.db.transaction(async (tx) => {
          await lockProgramPool(tx, programId);
          const { available } = await poolBalance(tx, programId);
          if (available.amountMinor < want) throw new Error('pool_insufficient');
          await reserve(tx, {
            programId,
            claimId: c.id,
            amount: money(want),
            source: 'decision',
            now: NOW,
          });
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await poolBalance(h.db, programId)).available.amountMinor).toBe(0);
  });

  it('7: every transition writes a decision log row, and the log is append-only', async () => {
    const claim = await approvedClaim();
    const log = await listLog(h.db, claim.id);
    expect(log.map((r) => r.action)).toEqual(['created', 'decided']);
    expect(log[1]?.data).toMatchObject({ from: 'checking', to: 'approved' });
    await failsWith(
      h.db.execute(sql`UPDATE decision_log SET action = 'x' WHERE claim_id = ${claim.id}`),
      /append-only/,
    );
    await failsWith(
      h.db.execute(sql`DELETE FROM decision_log WHERE claim_id = ${claim.id}`),
      /append-only/,
    );
  });

  it('refuses non-positive ledger amounts', async () => {
    await upsertPrograms(h.db, demoPrograms(), NOW);
    await expect(
      addFunding(h.db, {
        programId: 'columbia-pikeminnow',
        amount: money(0),
        source: 'x',
        now: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe('programs', () => {
  it('bumps the version only when a program file changes', async () => {
    const list = demoPrograms();
    const first = await upsertPrograms(h.db, list, NOW);
    const again = await upsertPrograms(h.db, list, NOW);
    expect(again.map((p) => p.version)).toEqual(first.map((p) => p.version));
    const changed = list.map((p) =>
      p.id === 'lake-roosevelt-pike' ? { ...p, name: `${p.name}!` } : p,
    );
    const bumped = await upsertPrograms(h.db, changed, NOW);
    expect(bumped.find((p) => p.id === 'lake-roosevelt-pike')?.version).toBe(
      (first.find((p) => p.id === 'lake-roosevelt-pike')?.version ?? 0) + 1,
    );
  });
});
