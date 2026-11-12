import type { ReasonCode } from '@bountyline/contracts';
import { money, type Money } from '../money/money.js';
import type { Program } from '../program/program.js';

/** The reward for the claimant's n-th eligible fish this season (n starts at 1). */
export function rewardFor(program: Pick<Program, 'rewards'>, seasonCount: number): Money {
  if (!Number.isInteger(seasonCount) || seasonCount < 1) {
    throw new RangeError(`seasonCount must be a positive integer, got ${seasonCount}`);
  }
  const r = program.rewards;
  if (r.scheme === 'flat') return money(r.amountMinor);
  const sorted = [...r.tiers].sort((a, b) => a.fromCount - b.fromCount);
  let amount: number | null = null;
  for (const tier of sorted) {
    if (seasonCount >= tier.fromCount) amount = tier.amountMinor;
  }
  if (amount === null) throw new RangeError(`No tier covers fish number ${seasonCount}`);
  return money(amount);
}

/** The count at which the next higher tier starts, or null when on the top tier or flat. */
export function nextTierAt(program: Pick<Program, 'rewards'>, seasonCount: number): number | null {
  const r = program.rewards;
  if (r.scheme === 'flat') return null;
  const next = [...r.tiers]
    .sort((a, b) => a.fromCount - b.fromCount)
    .find((t) => t.fromCount > seasonCount);
  return next ? next.fromCount : null;
}

export type BudgetResult =
  | { ok: true }
  | { ok: false; reason: Extract<ReasonCode, 'pool_insufficient' | 'daily_payout_cap'> };

/** Checks the pool balance and the per-receiver daily cap before a reservation. */
export function guardBudget(input: {
  amount: Money;
  poolAvailable: Money;
  receiverPaidToday: Money;
  cap: Money;
}): BudgetResult {
  if (input.amount.amountMinor > input.poolAvailable.amountMinor) {
    return { ok: false, reason: 'pool_insufficient' };
  }
  if (input.receiverPaidToday.amountMinor + input.amount.amountMinor > input.cap.amountMinor) {
    return { ok: false, reason: 'daily_payout_cap' };
  }
  return { ok: true };
}

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic audit sampling: hash(claimId) mod 100 < sampleRatePercent. */
export function shouldAudit(claimId: string, sampleRatePercent: number): boolean {
  return fnv1a(claimId) % 100 < sampleRatePercent;
}
