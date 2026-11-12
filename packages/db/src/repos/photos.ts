import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { claims, photos } from '../schema.js';
import type { PhotoRecord } from '../types.js';
import { scopeCondition } from './claims.js';

export async function insertPhoto(
  db: DbOrTx,
  input: typeof photos.$inferInsert,
): Promise<PhotoRecord> {
  const [row] = await db.insert(photos).values(input).returning();
  if (!row) throw new Error('insert photos returned nothing');
  return row;
}

export async function getPhoto(db: DbOrTx, id: string): Promise<PhotoRecord | null> {
  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  return row ?? null;
}

export interface DuplicateCandidate {
  claimId: string;
  photoId: string;
  sameSha: boolean;
  distance: number;
}

/**
 * Nearest prior claims by pHash Hamming distance (bit_count of the XOR), within the scope, with an
 * exact SHA-256 match flagged. Returns at most `limit` rows, closest first.
 */
export async function findDuplicateCandidates(
  db: DbOrTx,
  input: {
    claimId: string;
    sha256: string;
    phash: bigint;
    judgeSessionId: string | null;
    limit?: number;
  },
): Promise<DuplicateCandidate[]> {
  const distance = sql<number>`bit_count((${photos.phash} # ${input.phash}::bigint)::bit(64))::int`;
  const rows = await db
    .select({
      claimId: claims.id,
      photoId: photos.id,
      sha256: photos.sha256,
      distance,
    })
    .from(claims)
    .innerJoin(photos, eq(claims.photoId, photos.id))
    .where(
      and(
        isNotNull(claims.photoId),
        sql`${claims.id} <> ${input.claimId}`,
        // Sample photos are public (Judge mode), so real claims are compared with them too.
        input.judgeSessionId === null
          ? or(scopeCondition(null), eq(photos.sample, true))
          : scopeCondition(input.judgeSessionId),
      ),
    )
    .orderBy(distance)
    .limit(input.limit ?? 5);
  return rows.map((r) => ({
    claimId: r.claimId,
    photoId: r.photoId,
    sameSha: r.sha256 === input.sha256,
    distance: Number(r.distance),
  }));
}
