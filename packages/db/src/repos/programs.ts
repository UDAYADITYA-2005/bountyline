import { createHash } from 'node:crypto';
import type { Program } from '@bountyline/core';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../client.js';
import { programs } from '../schema.js';

export interface ProgramRow {
  id: string;
  version: number;
  program: Program;
}

function hashConfig(p: Program): string {
  return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}

/** Upserts programs from config; a changed file bumps the version. Returns the stored rows. */
export async function upsertPrograms(
  db: DbOrTx,
  list: Program[],
  now: Date,
): Promise<ProgramRow[]> {
  const out: ProgramRow[] = [];
  for (const p of list) {
    const hash = hashConfig(p);
    const [existing] = await db.select().from(programs).where(eq(programs.id, p.id));
    if (!existing) {
      await db
        .insert(programs)
        .values({ id: p.id, version: 1, config: p, configHash: hash, loadedAt: now });
      out.push({ id: p.id, version: 1, program: p });
    } else if (existing.configHash !== hash) {
      const version = existing.version + 1;
      await db
        .update(programs)
        .set({ version, config: p, configHash: hash, loadedAt: now })
        .where(eq(programs.id, p.id));
      out.push({ id: p.id, version, program: p });
    } else {
      out.push({ id: p.id, version: existing.version, program: p });
    }
  }
  return out;
}

export async function getProgramVersion(db: DbOrTx, id: string): Promise<number | null> {
  const [row] = await db
    .select({ version: programs.version })
    .from(programs)
    .where(eq(programs.id, id));
  return row?.version ?? null;
}

/** Locks a program's pool row for the rest of the transaction (invariant 6). */
export async function lockProgramPool(tx: Tx, programId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM programs WHERE id = ${programId} FOR UPDATE`);
}
