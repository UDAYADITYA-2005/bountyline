import { describe, expect, it } from 'vitest';
import { add, compare, formatUsd, money, subtract } from './money.js';

describe('money', () => {
  it('builds integer cent values', () => {
    expect(money(800)).toEqual({ amountMinor: 800, currency: 'USD' });
  });

  it.each([0.5, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses non-integer cents %s', (v) => {
    expect(() => money(v)).toThrow(/integer/);
  });

  it('adds, subtracts and compares', () => {
    expect(add(money(600), money(800)).amountMinor).toBe(1400);
    expect(subtract(money(600), money(800)).amountMinor).toBe(-200);
    expect(compare(money(1), money(2))).toBe(-1);
    expect(compare(money(2), money(2))).toBe(0);
    expect(compare(money(3), money(2))).toBe(1);
  });

  it.each([
    [0, '$0.00'],
    [1, '$0.01'],
    [99, '$0.99'],
    [100, '$1.00'],
    [600, '$6.00'],
    [50000, '$500.00'],
    [500000, '$5,000.00'],
    [-250, '-$2.50'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatUsd(money(cents))).toBe(text);
  });
});
