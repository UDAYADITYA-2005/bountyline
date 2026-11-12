import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { webhookEvents } from '../schema.js';
import type { WebhookEventRecord } from '../types.js';

/** Stores an event by its PayPal ID. Returns false for a replay (nothing inserted). */
export async function insertWebhookEventIfNew(
  db: DbOrTx,
  input: {
    id: string;
    eventType: string;
    resourceId: string | null;
    payload: unknown;
    receivedAt: Date;
  },
): Promise<boolean> {
  const rows = await db
    .insert(webhookEvents)
    .values({ ...input, verified: true })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id });
  return rows.length === 1;
}

export async function markWebhookProcessed(
  db: DbOrTx,
  id: string,
  input: { processedAt: Date | null; error: string | null },
): Promise<void> {
  await db.update(webhookEvents).set(input).where(eq(webhookEvents.id, id));
}

export async function getWebhookEvent(db: DbOrTx, id: string): Promise<WebhookEventRecord | null> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
  return row ?? null;
}

export async function listWebhookEvents(db: DbOrTx): Promise<WebhookEventRecord[]> {
  return db.select().from(webhookEvents).orderBy(webhookEvents.receivedAt);
}
