import type { ClaimStatus } from '@bountyline/contracts';
import { transition, type ClaimEvent } from '@bountyline/core';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client.js';
import { claims, decisionLog } from '../schema.js';
import { toClaimRecord, type Actor, type ClaimRecord } from '../types.js';

export async function insertClaim(
  db: DbOrTx,
  input: typeof claims.$inferInsert,
  actor: Actor,
): Promise<ClaimRecord> {
  const [row] = await db.insert(claims).values(input).returning();
  if (!row) throw new Error('insert claims returned nothing');
  await appendLog(db, {
    at: input.createdAt,
    claimId: row.id,
    actor,
    action: 'created',
    data: { programId: input.programId, source: input.source },
  });
  return toClaimRecord(row);
}

export async function getClaim(db: DbOrTx, id: string): Promise<ClaimRecord | null> {
  const [row] = await db.select().from(claims).where(eq(claims.id, id));
  return row ? toClaimRecord(row) : null;
}

/** Reads a claim and locks its row for the rest of the transaction. */
export async function getClaimForUpdate(tx: Tx, id: string): Promise<ClaimRecord | null> {
  const [row] = await tx.select().from(claims).where(eq(claims.id, id)).for('update');
  return row ? toClaimRecord(row) : null;
}

type ClaimPatch = Partial<
  Omit<typeof claims.$inferInsert, 'id' | 'status' | 'createdAt' | 'updatedAt'>
>;

/**
 * Applies a state-machine event to a locked claim, writes the patch, and appends the decision log
 * in the same transaction (invariant 7). Throws INVALID_STATE for an illegal move.
 */
export async function transitionClaim(
  tx: Tx,
  input: {
    claimId: string;
    event: ClaimEvent;
    now: Date;
    actor: Actor;
    action: string;
    data?: Record<string, unknown>;
    patch?: ClaimPatch;
  },
): Promise<ClaimRecord> {
  const current = await getClaimForUpdate(tx, input.claimId);
  if (!current) throw new Error(`claim ${input.claimId} not found`);
  const next: ClaimStatus = transition(current.status, input.event);
  const [row] = await tx
    .update(claims)
    .set({ ...input.patch, status: next, updatedAt: input.now })
    .where(eq(claims.id, input.claimId))
    .returning();
  if (!row) throw new Error('update claims returned nothing');
  await appendLog(tx, {
    at: input.now,
    claimId: input.claimId,
    actor: input.actor,
    action: input.action,
    data: { from: current.status, to: next, ...input.data },
  });
  return toClaimRecord(row);
}

/** Updates fields that are not the status (evidence fields, audit status). */
export async function patchClaim(
  db: DbOrTx,
  claimId: string,
  patch: ClaimPatch,
  now: Date,
): Promise<void> {
  await db
    .update(claims)
    .set({ ...patch, updatedAt: now })
    .where(eq(claims.id, claimId));
}

export interface ClaimFilter {
  claimantId?: string | undefined;
  programId?: string | undefined;
  statuses?: ClaimStatus[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** ULIDs sort by time, so the cursor is the last claim ID seen. */
  cursor?: string | undefined;
  limit: number;
}

export async function listClaims(db: DbOrTx, f: ClaimFilter): Promise<ClaimRecord[]> {
  const where: SQL[] = [];
  if (f.claimantId) where.push(eq(claims.claimantId, f.claimantId));
  if (f.programId) where.push(eq(claims.programId, f.programId));
  if (f.statuses && f.statuses.length > 0) where.push(inArray(claims.status, f.statuses));
  if (f.from) where.push(gte(claims.createdAt, f.from));
  if (f.to) where.push(lte(claims.createdAt, f.to));
  if (f.cursor) where.push(lt(claims.id, f.cursor));
  const rows = await db
    .select()
    .from(claims)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(claims.id))
    .limit(f.limit);
  return rows.map(toClaimRecord);
}

export async function listAllClaims(db: DbOrTx, limit = 2000): Promise<ClaimRecord[]> {
  const rows = await db.select().from(claims).orderBy(desc(claims.id)).limit(limit);
  return rows.map(toClaimRecord);
}

/** Claims in code_issued whose code has expired. */
export async function listExpiredCodes(db: DbOrTx, now: Date, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.status, 'code_issued'), lt(claims.codeExpiresAt, now)))
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Approved-at-least-once claims this season for the claimant (drives reward tiers). Judge
 * claimants are created per judge session, so scoping by claimant also scopes by session.
 */
export async function countSeasonApproved(
  db: DbOrTx,
  input: { claimantId: string; programId: string; seasonStartUtc: Date; excludeClaimId: string },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(claims)
    .where(
      and(
        eq(claims.claimantId, input.claimantId),
        eq(claims.programId, input.programId),
        inArray(claims.status, ['approved', 'paying', 'paid', 'payout_issue']),
        gte(claims.submittedAt, input.seasonStartUtc),
        sql`${claims.id} <> ${input.excludeClaimId}`,
      ),
    );
  return row?.n ?? 0;
}

/** Submissions by the claimant in a window (claim rate check). */
export async function countSubmissionsSince(
  db: DbOrTx,
  input: { claimantId: string; programId: string; since: Date; excludeClaimId: string },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(claims)
    .where(
      and(
        eq(claims.claimantId, input.claimantId),
        eq(claims.programId, input.programId),
        gte(claims.submittedAt, input.since),
        sql`${claims.id} <> ${input.excludeClaimId}`,
      ),
    );
  return row?.n ?? 0;
}

export async function appendLog(
  db: DbOrTx,
  input: { at: Date; claimId: string; actor: Actor; action: string; data: Record<string, unknown> },
): Promise<void> {
  await db.insert(decisionLog).values({
    at: input.at,
    claimId: input.claimId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    data: input.data,
  });
}

export async function listLog(db: DbOrTx, claimId: string) {
  return db
    .select()
    .from(decisionLog)
    .where(eq(decisionLog.claimId, claimId))
    .orderBy(decisionLog.id);
}

/**
 * Which claims a duplicate search may see. Real claims see real claims. A judge session sees its
 * own claims plus the seeded history (judge-source claims with no session), so judges never
 * collide and `reused-photo` still has something to match.
 */
export function scopeCondition(judgeSessionId: string | null): SQL {
  if (judgeSessionId === null) return eq(claims.source, 'app');
  return (
    or(
      eq(claims.judgeSessionId, judgeSessionId),
      and(eq(claims.source, 'judge_scenario'), isNull(claims.judgeSessionId)),
    ) ?? sql`false`
  );
}

/** True when the photo belongs to one of the user's claims. */
export async function claimantOwnsPhoto(
  db: DbOrTx,
  userId: string,
  photoId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.claimantId, userId), eq(claims.photoId, photoId)))
    .limit(1);
  return row !== undefined;
}

/** A claim by scenario ID (used by the seed to stay idempotent). */
export async function findClaimByScenario(
  db: DbOrTx,
  scenarioId: string,
): Promise<ClaimRecord | null> {
  const [row] = await db.select().from(claims).where(eq(claims.scenarioId, scenarioId)).limit(1);
  return row ? toClaimRecord(row) : null;
}

/** Claims still in `checking` long after evidence arrived (a crash mid-run). */
export async function listStuckChecking(
  db: DbOrTx,
  olderThan: Date,
  limit = 20,
): Promise<string[]> {
  const rows = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.status, 'checking'), lt(claims.updatedAt, olderThan)))
    .limit(limit);
  return rows.map((r) => r.id);
}
