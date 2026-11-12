import type { ClaimStatus, DeskAuditBody, DeskDecisionBody, PoolView } from '@bountyline/contracts';
import { DomainError, startOfUtcDay } from '@bountyline/core';
import { reserveAndEnqueue, storedReason } from '@bountyline/checks';
import {
  appendLog,
  getClaimForUpdate,
  getPayoutJob,
  getReservation,
  listClaims,
  listLog,
  paidSince,
  patchClaim,
  poolBalance,
  release,
  requeueForRetry,
  transitionClaim,
  type ClaimRecord,
  type UserRecord,
} from '@bountyline/db';
import type { AppDeps } from '../deps.js';
import { moneyView } from '../views.js';
import { UNCLAIMED } from './payout-service.js';

export class DeskService {
  constructor(private readonly deps: AppDeps) {}

  async list(q: {
    status?: ClaimStatus[] | undefined;
    programId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }) {
    const statuses = q.status;
    return listClaims(this.deps.db.db, {
      statuses,
      programId: q.programId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      cursor: q.cursor,
      limit: q.limit,
    });
  }

  async history(claimId: string) {
    return (await listLog(this.deps.db.db, claimId)).map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      data: (r.data ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * A manager clears a held claim or a payout issue. Approving runs the same budget guard and
   * reservation as an automatic approval; rejecting after a reservation releases it.
   */
  async decide(manager: UserRecord, claimId: string, body: DeskDecisionBody): Promise<ClaimRecord> {
    const { db, clock, programs, config } = this.deps;
    return db.db.transaction(async (tx) => {
      const now = clock.now();
      const claim = await getClaimForUpdate(tx, claimId);
      if (!claim) throw new DomainError('CLAIM_NOT_FOUND', 'No such claim.');
      if (claim.status !== 'held' && claim.status !== 'payout_issue') {
        throw new DomainError(
          'INVALID_STATE',
          `Only held claims and payout issues can be decided; this one is ${claim.status}.`,
        );
      }
      const entry = programs.get(claim.programId);
      if (!entry) throw new DomainError('PROGRAM_NOT_FOUND', 'Unknown program.');
      if (
        claim.status === 'payout_issue' &&
        (await getPayoutJob(tx, claim.id))?.lastError === UNCLAIMED
      ) {
        // The original item can still be claimed for 30 days: a retry could pay twice, and a
        // reject would release money that may still leave the account.
        throw new DomainError(
          'INVALID_STATE',
          'PayPal is holding this payout until the receiver claims it. Wait until PayPal returns it before retrying or rejecting.',
        );
      }
      const actor = { type: 'manager' as const, id: manager.id };
      const logData = { decision: body.decision, note: body.note, from: claim.status };

      if (body.decision === 'reject') {
        if (claim.status === 'payout_issue') {
          const reserved = await getReservation(tx, claim.id);
          if (reserved)
            await release(tx, {
              programId: claim.programId,
              claimId: claim.id,
              amount: reserved,
              source: 'manager',
              now,
            });
        }
        return transitionClaim(tx, {
          claimId,
          event: 'manager_reject',
          now,
          actor,
          action: 'manager_decision',
          data: logData,
          patch: {
            decision: 'reject',
            reasons: [...claim.reasons, storedReason('manager_rejected')],
            decidedAt: now,
          },
        });
      }

      if (claim.status === 'payout_issue') {
        const job = await requeueForRetry(tx, claim.id, now);
        return transitionClaim(tx, {
          claimId,
          event: 'manager_approve',
          now,
          actor,
          action: 'manager_decision',
          data: { ...logData, retryAttempt: job.attempt, senderBatchId: job.senderBatchId },
          patch: {
            reasons: claim.reasons
              .filter((r) => r.code !== 'payout_failed' && r.code !== 'payout_unclaimed')
              .concat(storedReason('manager_approved')),
          },
        });
      }

      const money = await reserveAndEnqueue(tx, {
        claim,
        program: entry.program,
        judgeMode: config.JUDGE_MODE,
        now,
      });
      if (!money.ok) {
        const reasons = [
          ...claim.reasons.filter((r) => r.code !== money.reason),
          storedReason(money.reason),
        ];
        await patchClaim(tx, claim.id, { reasons }, now);
        await appendLog(tx, {
          at: now,
          claimId,
          actor,
          action: 'manager_decision',
          data: { ...logData, blocked: money.reason },
        });
        return { ...claim, reasons, updatedAt: now };
      }
      return transitionClaim(tx, {
        claimId,
        event: 'manager_approve',
        now,
        actor,
        action: 'manager_decision',
        data: { ...logData, amountMinor: money.amount.amountMinor },
        patch: {
          decision: 'approve',
          amountMinor: money.amount.amountMinor,
          reasons: [...claim.reasons, storedReason('manager_approved')],
          decidedAt: now,
        },
      });
    });
  }

  /** Requests a hand-in audit of a paid claim, or records its result. */
  async audit(manager: UserRecord, claimId: string, body: DeskAuditBody): Promise<ClaimRecord> {
    return this.deps.db.db.transaction(async (tx) => {
      const now = this.deps.clock.now();
      const claim = await getClaimForUpdate(tx, claimId);
      if (!claim) throw new DomainError('CLAIM_NOT_FOUND', 'No such claim.');
      const next =
        body.action === 'request'
          ? claim.status === 'paid' && claim.auditStatus === 'none'
            ? 'requested'
            : null
          : claim.auditStatus === 'requested'
            ? body.action === 'pass'
              ? 'passed'
              : 'failed'
            : null;
      if (!next)
        throw new DomainError(
          'INVALID_STATE',
          `Can't ${body.action} an audit for a ${claim.status} claim with audit ${claim.auditStatus}.`,
        );
      await patchClaim(tx, claimId, { auditStatus: next }, now);
      await appendLog(tx, {
        at: now,
        claimId,
        actor: { type: 'manager', id: manager.id },
        action: body.action === 'request' ? 'audit_requested' : 'audit_resolved',
        data: { audit: next, note: body.note ?? null },
      });
      return { ...claim, auditStatus: next, updatedAt: now };
    });
  }

  async pools(programId?: string): Promise<PoolView[]> {
    const db = this.deps.db.db;
    const ids = programId ? [programId] : [...this.deps.programs.keys()];
    if (programId && !this.deps.programs.has(programId))
      throw new DomainError('PROGRAM_NOT_FOUND', 'Unknown program.');
    const since = startOfUtcDay(this.deps.clock.now());
    return Promise.all(
      ids.map(async (id) => {
        const b = await poolBalance(db, id);
        return {
          programId: id,
          funded: moneyView(b.funded),
          reserved: moneyView(b.reserved),
          released: moneyView(b.released),
          available: moneyView(b.available),
          paidToday: moneyView(await paidSince(db, id, since)),
        };
      }),
    );
  }
}
