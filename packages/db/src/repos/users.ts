import { and, eq, gt, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { sessions, users } from '../schema.js';
import type { UserRecord } from '../types.js';

export async function createUser(
  db: DbOrTx,
  input: typeof users.$inferInsert,
): Promise<UserRecord> {
  const [row] = await db.insert(users).values(input).returning();
  if (!row) throw new Error('insert users returned nothing');
  return row;
}

export async function findUserByEmail(db: DbOrTx, email: string): Promise<UserRecord | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

export async function getUser(db: DbOrTx, id: string): Promise<UserRecord | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function updateUserPassword(
  db: DbOrTx,
  id: string,
  passwordHash: string,
): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export async function createSession(
  db: DbOrTx,
  input: { id: string; userId: string; expiresAt: Date; createdAt: Date },
): Promise<void> {
  await db.insert(sessions).values(input);
}

/** The user behind a live session, or null when missing or expired. */
export async function getSessionUser(
  db: DbOrTx,
  sessionId: string,
  now: Date,
): Promise<UserRecord | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)));
  return row?.user ?? null;
}

export async function deleteSession(db: DbOrTx, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Display names by user ID (desk rows). */
export async function listUserNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
