import type { CheckResult } from '@bountyline/core';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { claimChecks, geminiUsage, visionResults } from '../schema.js';
import type { CheckRecord } from '../types.js';

/** Writes a claim's check results, replacing any earlier run. */
export async function replaceChecks(
  db: DbOrTx,
  claimId: string,
  results: readonly CheckResult[],
  now: Date,
): Promise<void> {
  await db.delete(claimChecks).where(eq(claimChecks.claimId, claimId));
  if (results.length === 0) return;
  await db.insert(claimChecks).values(
    results.map((r) => ({
      claimId,
      checkKey: r.key,
      status: r.status,
      confidence: r.confidence ?? null,
      detail: r.detail.slice(0, 500),
      reason: r.reason ?? null,
      evidence: r.evidence ?? null,
      createdAt: now,
    })),
  );
}

export async function listChecks(db: DbOrTx, claimId: string): Promise<CheckRecord[]> {
  return db.select().from(claimChecks).where(eq(claimChecks.claimId, claimId));
}

export async function getVisionCache(
  db: DbOrTx,
  key: { sha256: string; model: string; promptVersion: number },
): Promise<unknown | null> {
  const [row] = await db
    .select({ result: visionResults.result })
    .from(visionResults)
    .where(
      sql`${visionResults.photoSha256} = ${key.sha256} AND ${visionResults.model} = ${key.model} AND ${visionResults.promptVersion} = ${key.promptVersion}`,
    );
  return row ? row.result : null;
}

export async function putVisionCache(
  db: DbOrTx,
  key: { sha256: string; model: string; promptVersion: number },
  result: unknown,
  now: Date,
): Promise<void> {
  await db
    .insert(visionResults)
    .values({
      photoSha256: key.sha256,
      model: key.model,
      promptVersion: key.promptVersion,
      result,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [visionResults.photoSha256, visionResults.model, visionResults.promptVersion],
      set: { result, createdAt: now },
    });
}

/** Atomically counts one Gemini request for the day and returns the new total. */
export async function incrementGeminiUsage(db: DbOrTx, day: string): Promise<number> {
  const [row] = await db
    .insert(geminiUsage)
    .values({ day, requests: 1 })
    .onConflictDoUpdate({
      target: geminiUsage.day,
      set: { requests: sql`${geminiUsage.requests} + 1` },
    })
    .returning({ requests: geminiUsage.requests });
  return row?.requests ?? 0;
}

export async function getGeminiUsage(db: DbOrTx, day: string): Promise<number> {
  const [row] = await db.select().from(geminiUsage).where(eq(geminiUsage.day, day));
  return row?.requests ?? 0;
}
