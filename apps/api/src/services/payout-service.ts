import { canTransition, money, shouldAudit, type PayoutItemOutcome } from '@bountyline/core';
import { storedReason } from '@bountyline/checks';
import {
  appendLog,
  claimDueJobs,
  findJobByItemId,
  getClaim,
  getClaimForUpdate,
  getPayoutJob,
  insertWebhookEventIfNew,
  listStaleSent,
  markJob,
  markWebhookProcessed,
  patchClaim,
  requeueStuckSending,
  transitionClaim,
  SYSTEM,
  type PayoutJobRecord,
  type Tx,
} from '@bountyline/db';
import {
  PayPalError,
  effectOf,
  maskEmail,
  parseWebhookEvent,
  verifyWebhook,
  type WebhookHeaders,
} from '@bountyline/paypal';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '../deps.js';

/** Backoff after network errors and 5xx: 2, 4, 8, 16, 32 s, then hourly. */
export function retryDelayMs(tries: number): number {
  const schedule = [2_000, 4_000, 8_000, 16_000, 32_000];
  return schedule[tries - 1] ?? 3_600_000;
}

const STUCK_MS = 2 * 60_000;

/** Job marker for an item PayPal holds until the receiver claims it. */
export const UNCLAIMED = 'UNCLAIMED';

/**
 * The only code that moves money: the payout dispatcher, plus the webhook and reconciler that
 * confirm it. Every claim change goes through the state machine and writes the decision log.
 */
export class PayoutService {
  constructor(
    private readonly deps: AppDeps,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Sends due payout jobs. Returns how many were attempted. */
  async dispatchOnce(): Promise<number> {
    const gateway = this.deps.payoutGateway;
    if (!gateway) return 0;
    const db = this.deps.db.db;
    const jobs = await db.transaction((tx) => claimDueJobs(tx, this.deps.clock.now()));
    for (const job of jobs) await this.sendOne(job);
    return jobs.length;
  }

  private async sendOne(job: PayoutJobRecord): Promise<void> {
    const gateway = this.deps.payoutGateway;
    const db = this.deps.db.db;
    if (!gateway) return;
    const claim = await getClaim(db, job.claimId);
    const log = this.log.child({ claimId: job.claimId });
    if (!claim || claim.status !== 'approved') {
      // Only approved claims are paid; anything else is a state the dispatcher must not act on.
      await markJob(db, job.claimId, {
        status: claim?.status === 'paid' ? 'succeeded' : 'failed',
        lastError: `claim is ${claim?.status ?? 'missing'}`,
        updatedAt: this.deps.clock.now(),
      });
      return;
    }
    try {
      const created = await gateway
        .createPayout({
          claimId: job.claimId,
          attempt: job.attempt,
          receiver: job.receiver,
          amount: money(job.amountMinor),
          note: `Bountyline claim ${job.claimId}`,
        })
        .catch((e: unknown) => {
          // PayPal already has this sender_batch_id: the money was sent. Never a failure.
          if (e instanceof PayPalError && e.kind === 'DuplicateBatch') {
            return {
              payoutBatchId: e.existingBatchId ?? '',
              batchStatus: 'UNKNOWN',
              alreadyExisted: true,
            };
          }
          throw e;
        });
      await db.transaction(async (tx) => {
        const now = this.deps.clock.now();
        await markJob(tx, job.claimId, {
          status: 'sent',
          paypalBatchId: created.payoutBatchId || null,
          lastError: null,
          updatedAt: now,
        });
        const locked = await getClaimForUpdate(tx, job.claimId);
        if (locked && canTransition(locked.status, 'dispatch')) {
          await transitionClaim(tx, {
            claimId: job.claimId,
            event: 'dispatch',
            now,
            actor: SYSTEM,
            action: 'payout_sent',
            data: {
              payoutBatchId: created.payoutBatchId,
              alreadyExisted: created.alreadyExisted,
              attempt: job.attempt,
            },
          });
        }
      });
      log.info(
        {
          batch: created.payoutBatchId,
          receiver: maskEmail(job.receiver),
          alreadyExisted: created.alreadyExisted,
        },
        'payout sent',
      );
    } catch (e) {
      const now = this.deps.clock.now();
      const retryable = !(e instanceof PayPalError) || e.retryable;
      if (retryable) {
        const tries = job.tries + 1;
        await markJob(db, job.claimId, {
          status: 'queued',
          tries,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(tries)),
          lastError: e instanceof PayPalError ? e.kind : 'Unexpected',
          updatedAt: now,
        });
        log.warn(
          { tries, kind: e instanceof PayPalError ? e.kind : 'Unexpected' },
          'payout retry scheduled',
        );
        return;
      }
      const name = (e as PayPalError).paypalName ?? (e as PayPalError).kind;
      await db.transaction(async (tx) => {
        await markJob(tx, job.claimId, { status: 'failed', lastError: name, updatedAt: now });
        await this.moveToIssue(tx, job.claimId, 'payout_failed', {
          error: name,
          attempt: job.attempt,
        });
      });
      log.warn({ error: name }, 'payout failed');
    }
  }

  private async moveToIssue(
    tx: Tx,
    claimId: string,
    reason: 'payout_failed' | 'payout_unclaimed',
    data: Record<string, unknown>,
  ): Promise<void> {
    const claim = await getClaimForUpdate(tx, claimId);
    if (!claim || !canTransition(claim.status, 'payout_failed')) return;
    await transitionClaim(tx, {
      claimId,
      event: 'payout_failed',
      now: this.deps.clock.now(),
      actor: SYSTEM,
      action: 'payout_issue',
      data: { reason, ...data },
      patch: { reasons: [...claim.reasons.filter((r) => r.code !== reason), storedReason(reason)] },
    });
  }

  /** Applies what PayPal says about an item, from a webhook or the reconciler. Final states never move. */
  async applyOutcome(
    tx: Tx,
    claimId: string,
    outcome: PayoutItemOutcome,
    meta: {
      itemId: string | null;
      batchId: string | null;
      via: 'webhook' | 'reconciler';
      eventType?: string;
    },
  ): Promise<void> {
    const now = this.deps.clock.now();
    const job = await getPayoutJob(tx, claimId);
    if (!job) return;
    // sender_item_id is the claim ID on every attempt, so an event can be about an older batch.
    // Only the current attempt's batch may move the claim; an event never re-points a retry.
    if (meta.batchId) {
      const otherBatch = job.paypalBatchId !== null && job.paypalBatchId !== meta.batchId;
      const unknownRetryBatch = job.paypalBatchId === null && job.attempt > 0;
      if (otherBatch || unknownRetryBatch) {
        this.log.warn(
          { claimId, attempt: job.attempt, via: meta.via },
          'ignored PayPal update for an older payout attempt',
        );
        return;
      }
    }
    const ids = {
      ...(meta.itemId ? { paypalItemId: meta.itemId } : {}),
      ...(meta.batchId && !job.paypalBatchId ? { paypalBatchId: meta.batchId } : {}),
    };
    if (outcome === 'succeeded') {
      await markJob(tx, claimId, { status: 'succeeded', lastError: null, updatedAt: now, ...ids });
      const claim = await getClaimForUpdate(tx, claimId);
      if (!claim || !canTransition(claim.status, 'paid')) return;
      const audit = shouldAudit(
        claimId,
        this.deps.programs.get(claim.programId)?.program.audit.sampleRatePercent ?? 0,
      );
      await transitionClaim(tx, {
        claimId,
        event: 'paid',
        now,
        actor: SYSTEM,
        action: 'paid',
        data: { via: meta.via, eventType: meta.eventType, payoutItemId: meta.itemId },
        patch: {
          reasons: claim.reasons.filter(
            (r) => r.code !== 'payout_unclaimed' && r.code !== 'payout_failed',
          ),
        },
      });
      if (audit) {
        await patchClaim(tx, claimId, { auditStatus: 'requested' }, now);
        await appendLog(tx, {
          at: now,
          claimId,
          actor: SYSTEM,
          action: 'audit_requested',
          data: { sampled: true },
        });
      }
      return;
    }
    if (outcome === 'failed' || outcome === 'unclaimed') {
      const reason = outcome === 'unclaimed' ? 'payout_unclaimed' : 'payout_failed';
      // Lock the claim before touching the job, so a concurrent SUCCEEDED can't interleave.
      const current = await getClaimForUpdate(tx, claimId);
      if (current?.status === 'paid') return; // A final state never moves backwards.
      await markJob(tx, claimId, {
        status: 'failed',
        // UNCLAIMED is not final at PayPal: the receiver can still claim it for 30 days.
        lastError: outcome === 'unclaimed' ? UNCLAIMED : (meta.eventType ?? 'FAILED'),
        updatedAt: now,
        ...ids,
      });
      await this.moveToIssue(tx, claimId, reason, { via: meta.via, eventType: meta.eventType });
      return;
    }
    if (outcome === 'held') {
      await markJob(tx, claimId, { lastError: 'HELD_BY_PAYPAL', updatedAt: now, ...ids });
      return;
    }
    if (Object.keys(ids).length > 0)
      await markJob(tx, claimId, { updatedAt: job.updatedAt, ...ids });
  }

  /** Verifies, stores by event ID, then applies the event. Returns the HTTP status to send. */
  async handleWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<{ status: 200 | 400; replay?: boolean }> {
    const webhookId = this.deps.config.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      this.log.warn('webhook received but PAYPAL_WEBHOOK_ID is not set');
      return { status: 400 };
    }
    const verified = await verifyWebhook({
      headers,
      rawBody,
      webhookId,
      getCert: this.deps.getCert,
    });
    if (!verified.ok) {
      this.log.warn({ reason: verified.reason }, 'webhook rejected');
      return { status: 400 };
    }
    let event;
    try {
      event = parseWebhookEvent(rawBody);
    } catch {
      return { status: 400 };
    }
    const db = this.deps.db.db;
    const now = this.deps.clock.now();
    try {
      const fresh = await db.transaction(async (tx) => {
        const inserted = await insertWebhookEventIfNew(tx, {
          id: event.id,
          eventType: event.eventType,
          resourceId: event.resourceId,
          payload: event.payload,
          receivedAt: now,
        });
        if (!inserted) return false;
        await this.processEvent(tx, event);
        await markWebhookProcessed(tx, event.id, { processedAt: now, error: null });
        return true;
      });
      return fresh ? { status: 200 } : { status: 200, replay: true };
    } catch (e) {
      // Keep the event (stored, with the error) so it is visible; the reconciler will resolve the claim.
      // Log the error class only: driver errors carry query params (payload, receiver email).
      this.log.error(
        { errName: (e as Error).name, eventId: event.id },
        'webhook processing failed',
      );
      await insertWebhookEventIfNew(db, {
        id: event.id,
        eventType: event.eventType,
        resourceId: event.resourceId,
        payload: event.payload,
        receivedAt: now,
      });
      await markWebhookProcessed(db, event.id, { processedAt: null, error: (e as Error).name });
      return { status: 200 };
    }
  }

  private async processEvent(tx: Tx, event: ReturnType<typeof parseWebhookEvent>): Promise<void> {
    const effect = effectOf(event.eventType);
    if (effect.kind === 'log_only') return;
    let claimId = event.senderItemId;
    if (!claimId && event.payoutItemId)
      claimId = (await findJobByItemId(tx, event.payoutItemId))?.claimId ?? null;
    if (!claimId || !(await getPayoutJob(tx, claimId))) return; // Not ours.
    const outcome: PayoutItemOutcome =
      effect.kind === 'paid'
        ? 'succeeded'
        : effect.kind === 'held_by_paypal'
          ? 'held'
          : effect.reason === 'payout_unclaimed'
            ? 'unclaimed'
            : 'failed';
    await this.applyOutcome(tx, claimId, outcome, {
      itemId: event.payoutItemId,
      batchId: event.payoutBatchId,
      via: 'webhook',
      eventType: event.eventType,
    });
  }

  /** Requeues jobs stuck in `sending`, and asks PayPal about jobs `sent` for over 2 minutes. */
  async reconcileOnce(): Promise<number> {
    const gateway = this.deps.payoutGateway;
    const db = this.deps.db.db;
    const now = this.deps.clock.now();
    const cutoff = new Date(now.getTime() - STUCK_MS);
    await requeueStuckSending(db, cutoff, now);
    if (!gateway) return 0;
    const stale = await listStaleSent(db, cutoff);
    let resolved = 0;
    for (const job of stale) {
      if (!job.paypalBatchId) {
        // A duplicate-batch reply without a link: only the webhook can resolve it. Rotate it so it
        // never starves the other stale jobs.
        await markJob(db, job.claimId, { updatedAt: now });
        continue;
      }
      try {
        const batch = await gateway.getPayoutBatch(job.paypalBatchId);
        // Match strictly by sender_item_id (the claim ID); never guess which item is ours.
        const item = batch.items.find((i) => i.senderItemId === job.claimId);
        if (!item || item.outcome === 'pending') {
          // Rotate it to the back of the queue so one slow batch can't starve the others.
          await markJob(db, job.claimId, { updatedAt: now });
          continue;
        }
        await db.transaction((tx) =>
          this.applyOutcome(tx, job.claimId, item.outcome, {
            itemId: item.payoutItemId,
            batchId: batch.payoutBatchId,
            via: 'reconciler',
            eventType: item.transactionStatus,
          }),
        );
        resolved += 1;
      } catch (e) {
        this.log.warn(
          { claimId: job.claimId, kind: e instanceof PayPalError ? e.kind : 'Unexpected' },
          'reconcile failed',
        );
      }
    }
    return resolved;
  }
}
