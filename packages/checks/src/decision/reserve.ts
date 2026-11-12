import {
  guardBudget,
  money,
  reasonMessage,
  rewardFor,
  zonedStartOfDay,
  type Money,
  type Program,
} from '@bountyline/core';
import type { ReasonCode } from '@bountyline/contracts';
import {
  addFunding,
  countSeasonApproved,
  enqueuePayout,
  getUser,
  lockProgramPool,
  poolBalance,
  receiverReservedSince,
  reserve,
  type ClaimRecord,
  type StoredReason,
  type Tx,
} from '@bountyline/db';

export const JUDGE_TOP_UP_BELOW = money(10_000);

/** Stored reason with its plain message. */
export function storedReason(code: ReasonCode, checkKey?: StoredReason['checkKey']): StoredReason {
  return { code, message: reasonMessage(code), ...(checkKey ? { checkKey } : {}) };
}

export type ReserveOutcome =
  | { ok: true; amount: Money; seasonCount: number }
  | { ok: false; reason: 'pool_insufficient' | 'daily_payout_cap' | 'check_error' };

/**
 * The approve path's money step, inside the caller's transaction: reward from the tiers, lock the
 * pool row, run the budget guard, then write the reservation and the payout job (the outbox).
 */
export async function reserveAndEnqueue(
  tx: Tx,
  input: { claim: ClaimRecord; program: Program; judgeMode: boolean; now: Date },
): Promise<ReserveOutcome> {
  const { claim, program, now } = input;
  const claimant = await getUser(tx, claim.claimantId);
  if (!claimant?.paypalEmail) return { ok: false, reason: 'check_error' };

  const seasonStartUtc = zonedStartOfDay(program.season.start, program.season.timezone);
  const prior = await countSeasonApproved(tx, {
    claimantId: claim.claimantId,
    programId: claim.programId,
    seasonStartUtc,
    excludeClaimId: claim.id,
  });
  const amount = rewardFor(program, prior + 1);

  await lockProgramPool(tx, program.id);
  let pool = await poolBalance(tx, program.id);
  // Judge mode only: keep the demo pool from running dry. Real programs never top up themselves.
  if (
    input.judgeMode &&
    claim.source === 'judge_scenario' &&
    pool.available.amountMinor < JUDGE_TOP_UP_BELOW.amountMinor
  ) {
    await addFunding(tx, {
      programId: program.id,
      amount: money(program.funding.seedMinor),
      source: 'judge_top_up',
      now,
    });
    pool = await poolBalance(tx, program.id);
  }

  const receiverKey = claim.judgeSessionId
    ? `${claimant.paypalEmail}#${claim.judgeSessionId}`
    : claimant.paypalEmail;
  const receiverPaidToday = await receiverReservedSince(tx, {
    receiverKey,
    since: new Date(now.getTime() - 24 * 3600_000),
  });
  const budget = guardBudget({
    amount,
    poolAvailable: pool.available,
    receiverPaidToday,
    cap: money(program.limits.maxPayoutMinorPerReceiverPerDay),
  });
  if (!budget.ok) return { ok: false, reason: budget.reason };

  await reserve(tx, { programId: program.id, claimId: claim.id, amount, source: 'decision', now });
  await enqueuePayout(tx, {
    claimId: claim.id,
    receiver: claimant.paypalEmail,
    receiverKey,
    amountMinor: amount.amountMinor,
    now,
  });
  return { ok: true, amount, seasonCount: prior + 1 };
}
