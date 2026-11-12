import { describe, expect, it } from 'vitest';
import { money } from '../money/money.js';
import type { RewardScheme } from '../program/program.js';
import { fnv1a, guardBudget, nextTierAt, rewardFor, shouldAudit } from './budget.js';

const pikeminnow: { rewards: RewardScheme } = {
  rewards: {
    scheme: 'cumulative_tiers',
    window: 'season',
    tiers: [
      { fromCount: 1, amountMinor: 600 },
      { fromCount: 26, amountMinor: 800 },
      { fromCount: 201, amountMinor: 1000 },
    ],
  },
};
const pike: { rewards: RewardScheme } = { rewards: { scheme: 'flat', amountMinor: 1000 } };

describe('rewardFor', () => {
  it.each([
    [1, 600],
    [25, 600],
    [26, 800],
    [200, 800],
    [201, 1000],
    [5000, 1000],
  ])('pays fish %i at %i cents in the pikeminnow tiers', (n, cents) => {
    expect(rewardFor(pikeminnow, n).amountMinor).toBe(cents);
  });

  it.each([1, 2, 99])('pays a flat $10 for pike %i', (n) => {
    expect(rewardFor(pike, n)).toEqual(money(1000));
  });

  it('refuses a non-positive count', () => {
    expect(() => rewardFor(pike, 0)).toThrow(RangeError);
  });

  it('reports the next tier', () => {
    expect(nextTierAt(pikeminnow, 12)).toBe(26);
    expect(nextTierAt(pikeminnow, 26)).toBe(201);
    expect(nextTierAt(pikeminnow, 300)).toBeNull();
    expect(nextTierAt(pike, 3)).toBeNull();
  });
});

describe('guardBudget', () => {
  const cap = money(30000);
  it('allows a reservation that uses the exact balance', () => {
    expect(
      guardBudget({
        amount: money(600),
        poolAvailable: money(600),
        receiverPaidToday: money(0),
        cap,
      }),
    ).toEqual({ ok: true });
  });

  it('holds when the pool is one cent short', () => {
    expect(
      guardBudget({
        amount: money(600),
        poolAvailable: money(599),
        receiverPaidToday: money(0),
        cap,
      }),
    ).toEqual({ ok: false, reason: 'pool_insufficient' });
  });

  it('allows reaching the receiver cap exactly', () => {
    expect(
      guardBudget({
        amount: money(1000),
        poolAvailable: money(100000),
        receiverPaidToday: money(29000),
        cap,
      }),
    ).toEqual({ ok: true });
  });

  it('holds when the receiver would pass the daily cap', () => {
    expect(
      guardBudget({
        amount: money(1000),
        poolAvailable: money(100000),
        receiverPaidToday: money(29001),
        cap,
      }),
    ).toEqual({ ok: false, reason: 'daily_payout_cap' });
  });
});

describe('audit sampling', () => {
  it('hashes with FNV-1a', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });

  it('is deterministic per claim', () => {
    const id = '01JC9Z6Q0M3V6T5K2W8N4R7Y1A';
    expect(shouldAudit(id, 10)).toBe(shouldAudit(id, 10));
  });

  it('samples nothing at 0% and everything at 100%', () => {
    expect(shouldAudit('x', 0)).toBe(false);
    expect(shouldAudit('x', 100)).toBe(true);
  });

  it('samples roughly the requested share', () => {
    let hits = 0;
    for (let i = 0; i < 2000; i += 1) if (shouldAudit(`claim-${i}`, 10)) hits += 1;
    expect(hits).toBeGreaterThan(140);
    expect(hits).toBeLessThan(260);
  });
});
