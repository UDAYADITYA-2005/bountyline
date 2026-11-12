import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client.js';
import { payoutJobs } from '../schema.js';
import type { PayoutJobRecord } from '../types.js';

/** sender_batch_id for an attempt: the claim ID, then claimId-r{n} after a manager retry. */
export function senderBatchIdFor(claimId: string, attempt: number): string {
  return attempt === 0 ? claimId : `${claimId}-r${attempt}`;
}

/** Creates the claim's one payout job (invariant 1: the primary key refuses a second). */
export async function enqueuePayout(
  db: DbOrTx,
  input: { claimId: string; receiver: string; receiverKey: string; amountMinor: number; now: Date },
): Promise<PayoutJobRecord> {
  const [row] = await db
    .insert(payoutJobs)
    .values({
      claimId: input.claimId,
      attempt: 0,
      senderBatchId: senderBatchIdFor(input.claimId, 0),
      status: 'queued',
      tries: 0,
      nextAttemptAt: input.now,
      receiver: input.receiver,
      receiverKey: input.receiverKey,
      amountMinor: input.amountMinor,
      updatedAt: input.now,
    })
    .returning();
  if (!row) throw new Error('insert payout_jobs returned nothing');
  return row;
}

/** A manager retry after a final failure: new attempt, new sender_batch_id, queued again. */
export async function requeueForRetry(
  tx: Tx,
  claimId: string,
  now: Date,
): Promise<PayoutJobRecord> {
  const job = await getPayoutJob(tx, claimId);
  if (!job) throw new Error(`no payout job for ${claimId}`);
  const attempt = job.attempt + 1;
  const [row] = await tx
    .update(payoutJobs)
    .set({
      attempt,
      senderBatchId: senderBatchIdFor(claimId, attempt),
      status: 'queued',
      tries: 0,
      nextAttemptAt: now,
      paypalBatchId: null,
      paypalItemId: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(payoutJobs.claimId, claimId))
    .returning();
  if (!row) throw new Error('update payout_jobs returned nothing');
  return row;
}

export async function getPayoutJob(db: DbOrTx, claimId: string): Promise<PayoutJobRecord | null> {
  const [row] = await db.select().from(payoutJobs).where(eq(payoutJobs.claimId, claimId));
  return row ?? null;
}

export async function findJobByBatchId(
  db: DbOrTx,
  batchId: string,
): Promise<PayoutJobRecord | null> {
  const [row] = await db.select().from(payoutJobs).where(eq(payoutJobs.paypalBatchId, batchId));
  return row ?? null;
}

export async function findJobByItemId(db: DbOrTx, itemId: string): Promise<PayoutJobRecord | null> {
  const [row] = await db.select().from(payoutJobs).where(eq(payoutJobs.paypalItemId, itemId));
  return row ?? null;
}

/**
 * Claims due queued jobs for this worker: locks them with FOR UPDATE SKIP LOCKED and marks them
 * `sending` in the same transaction, so two dispatchers never send the same job at once.
 */
export async function claimDueJobs(tx: Tx, now: Date, limit = 5): Promise<PayoutJobRecord[]> {
  const due = await tx
    .select()
    .from(payoutJobs)
    .where(and(eq(payoutJobs.status, 'queued'), lte(payoutJobs.nextAttemptAt, now)))
    .orderBy(asc(payoutJobs.nextAttemptAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (due.length === 0) return [];
  const ids = due.map((j) => j.claimId);
  return tx
    .update(payoutJobs)
    .set({ status: 'sending', updatedAt: now })
    .where(inArray(payoutJobs.claimId, ids))
    .returning();
}

export async function markJob(
  db: DbOrTx,
  claimId: string,
  patch: Partial<Omit<typeof payoutJobs.$inferInsert, 'claimId'>> & { updatedAt: Date },
): Promise<void> {
  await db.update(payoutJobs).set(patch).where(eq(payoutJobs.claimId, claimId));
}

/** Jobs stuck in `sending` (a crash mid-dispatch) go back to `queued`; the same ID makes it safe. */
export async function requeueStuckSending(db: DbOrTx, olderThan: Date, now: Date): Promise<number> {
  const rows = await db
    .update(payoutJobs)
    .set({ status: 'queued', nextAttemptAt: now, updatedAt: now })
    .where(and(eq(payoutJobs.status, 'sending'), lt(payoutJobs.updatedAt, olderThan)))
    .returning({ claimId: payoutJobs.claimId });
  return rows.length;
}

/** Jobs PayPal accepted that no webhook has resolved yet. */
export async function listStaleSent(
  db: DbOrTx,
  olderThan: Date,
  limit = 20,
): Promise<PayoutJobRecord[]> {
  return db
    .select()
    .from(payoutJobs)
    .where(and(eq(payoutJobs.status, 'sent'), lt(payoutJobs.updatedAt, olderThan)))
    .orderBy(asc(payoutJobs.updatedAt))
    .limit(limit);
}

export async function listPayoutJobs(db: DbOrTx, limit = 2000): Promise<PayoutJobRecord[]> {
  return db
    .select()
    .from(payoutJobs)
    .orderBy(sql`${payoutJobs.updatedAt} desc`)
    .limit(limit);
}
