import { money, type Money } from '@bountyline/core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { ledgerEntries, payoutJobs } from '../schema.js';
import type { LedgerRecord } from '../types.js';

export interface PoolBalance {
  funded: Money;
  reserved: Money;
  released: Money;
  available: Money;
}

/** Available pool = funding - reserve + release. */
export async function poolBalance(db: DbOrTx, programId: string): Promise<PoolBalance> {
  const rows = await db
    .select({
      kind: ledgerEntries.kind,
      total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.programId, programId))
    .groupBy(ledgerEntries.kind);
  const get = (k: string): number => Number(rows.find((r) => r.kind === k)?.total ?? 0);
  const funded = get('funding');
  const reserved = get('reserve');
  const released = get('release');
  return {
    funded: money(funded),
    reserved: money(reserved),
    released: money(released),
    available: money(funded - reserved + released),
  };
}

export async function addFunding(
  db: DbOrTx,
  input: { programId: string; amount: Money; source: string; now: Date },
): Promise<void> {
  await db.insert(ledgerEntries).values({
    programId: input.programId,
    kind: 'funding',
    amountMinor: input.amount.amountMinor,
    claimId: null,
    source: input.source,
    createdAt: input.now,
  });
}

export async function hasFundingFrom(
  db: DbOrTx,
  programId: string,
  source: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.programId, programId), eq(ledgerEntries.source, source)));
  return row !== undefined;
}

/** Reserves a claim's reward. The unique index refuses a second reserve (invariant 1). */
export async function reserve(
  db: DbOrTx,
  input: { programId: string; claimId: string; amount: Money; source: string; now: Date },
): Promise<void> {
  await db.insert(ledgerEntries).values({
    programId: input.programId,
    kind: 'reserve',
    amountMinor: input.amount.amountMinor,
    claimId: input.claimId,
    source: input.source,
    createdAt: input.now,
  });
}

/** Releases a claim's reservation; a trigger requires a matching reserve (invariant 4). */
export async function release(
  db: DbOrTx,
  input: { programId: string; claimId: string; amount: Money; source: string; now: Date },
): Promise<void> {
  await db.insert(ledgerEntries).values({
    programId: input.programId,
    kind: 'release',
    amountMinor: input.amount.amountMinor,
    claimId: input.claimId,
    source: input.source,
    createdAt: input.now,
  });
}

export async function getReservation(db: DbOrTx, claimId: string): Promise<Money | null> {
  const [row] = await db
    .select({ amount: ledgerEntries.amountMinor })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.claimId, claimId), eq(ledgerEntries.kind, 'reserve')));
  return row ? money(row.amount) : null;
}

/**
 * Reserved today for one receiver, net of releases. Counting reservations (not completed payouts)
 * means two claims racing for the cap can't both pass it.
 */
export async function receiverReservedSince(
  db: DbOrTx,
  input: { receiverKey: string; since: Date },
): Promise<Money> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
    .from(ledgerEntries)
    .innerJoin(payoutJobs, eq(payoutJobs.claimId, ledgerEntries.claimId))
    .where(
      and(
        eq(payoutJobs.receiverKey, input.receiverKey),
        eq(ledgerEntries.kind, 'reserve'),
        gte(ledgerEntries.createdAt, input.since),
        sql`NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.claim_id = ${ledgerEntries.claimId} AND r.kind = 'release')`,
      ),
    );
  return money(Number(row?.total ?? 0));
}

/** Total paid out (succeeded jobs) for a program since an instant. */
export async function paidSince(db: DbOrTx, programId: string, since: Date): Promise<Money> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${payoutJobs.amountMinor}), 0)` })
    .from(payoutJobs)
    .innerJoin(
      ledgerEntries,
      and(eq(ledgerEntries.claimId, payoutJobs.claimId), eq(ledgerEntries.kind, 'reserve')),
    )
    .where(
      and(
        eq(ledgerEntries.programId, programId),
        inArray(payoutJobs.status, ['succeeded']),
        gte(payoutJobs.updatedAt, since),
      ),
    );
  return money(Number(row?.total ?? 0));
}

export async function listLedger(db: DbOrTx, limit = 2000): Promise<LedgerRecord[]> {
  return db.select().from(ledgerEntries).orderBy(ledgerEntries.id).limit(limit);
}
