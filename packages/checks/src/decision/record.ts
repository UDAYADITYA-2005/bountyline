import { decide, type CheckResult, type Clock, type Program } from '@bountyline/core';
import { getClaimForUpdate, replaceChecks, transitionClaim, SYSTEM, type Db } from '@bountyline/db';
import { reserveAndEnqueue, storedReason } from './reserve.js';

export type AutomaticDecision =
  | { status: 'decided'; outcome: 'approve' | 'hold' | 'reject'; amountMinor: number | null }
  | { status: 'skipped'; reason: string };

/**
 * Writes check results and the rules engine's decision in one transaction. For an approval it also
 * reserves the reward and enqueues the payout job; the budget guard can turn it into a hold.
 */
export async function recordAutomaticDecision(
  deps: { db: Db; clock: Clock; judgeMode: boolean },
  input: { claimId: string; program: Program; programVersion: number; checks: CheckResult[] },
): Promise<AutomaticDecision> {
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const claim = await getClaimForUpdate(tx, input.claimId);
    if (!claim) return { status: 'skipped', reason: 'claim not found' };
    // Runs are retried (Workflows, crash recovery); a claim is decided once.
    if (claim.status !== 'checking')
      return { status: 'skipped', reason: `claim is ${claim.status}` };

    await replaceChecks(tx, claim.id, input.checks, now);
    const result = decide({ policy: input.program.decisionPolicy, checks: input.checks });
    // One line per reason code for the claimant: four vision checks being unavailable is one fact.
    const seen = new Set<string>();
    const reasons = result.reasons
      .filter((r) => !seen.has(r.code) && seen.add(r.code))
      .map((r) => storedReason(r.code, r.checkKey));
    const base = { claimId: claim.id, now, actor: SYSTEM, action: 'decided' };

    if (result.outcome === 'approve') {
      const money = await reserveAndEnqueue(tx, {
        claim,
        program: input.program,
        judgeMode: deps.judgeMode,
        now,
      });
      if (money.ok) {
        await transitionClaim(tx, {
          ...base,
          event: 'decide_approve',
          data: {
            outcome: 'approve',
            amountMinor: money.amount.amountMinor,
            seasonCount: money.seasonCount,
            rulesVersion: input.programVersion,
          },
          patch: {
            decision: 'approve',
            amountMinor: money.amount.amountMinor,
            reasons: [],
            decidedAt: now,
            programVersion: input.programVersion,
          },
        });
        return { status: 'decided', outcome: 'approve', amountMinor: money.amount.amountMinor };
      }
      const held = [storedReason(money.reason)];
      await transitionClaim(tx, {
        ...base,
        event: 'decide_hold',
        data: {
          outcome: 'hold',
          reasons: held.map((r) => r.code),
          rulesVersion: input.programVersion,
        },
        patch: {
          decision: 'hold',
          reasons: held,
          decidedAt: now,
          programVersion: input.programVersion,
        },
      });
      return { status: 'decided', outcome: 'hold', amountMinor: null };
    }

    await transitionClaim(tx, {
      ...base,
      event: result.outcome === 'hold' ? 'decide_hold' : 'decide_reject',
      data: {
        outcome: result.outcome,
        reasons: reasons.map((r) => r.code),
        rulesVersion: input.programVersion,
      },
      patch: {
        decision: result.outcome,
        reasons,
        decidedAt: now,
        programVersion: input.programVersion,
      },
    });
    return { status: 'decided', outcome: result.outcome, amountMinor: null };
  });
}
