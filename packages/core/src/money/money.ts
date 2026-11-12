import { DomainError } from '../errors.js';

export type Currency = 'USD';

/** An amount of money as an integer number of minor units (cents). */
export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

function assertMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new DomainError('VALIDATION_FAILED', 'Money must be an integer number of cents', {
      amountMinor,
    });
  }
}

/** Builds a USD Money value; throws on non-integer cents. */
export function money(amountMinor: number, currency: Currency = 'USD'): Money {
  assertMinor(amountMinor);
  return Object.freeze({ amountMinor, currency });
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('VALIDATION_FAILED', 'Currency mismatch', {
      a: a.currency,
      b: b.currency,
    });
  }
}

/** Adds two amounts of the same currency. */
export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Subtracts b from a; the result can be negative. */
export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/** Returns -1, 0 or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

/** Formats for display only, such as "$8.00", using integer math. */
export function formatUsd(m: Money): string {
  const negative = m.amountMinor < 0;
  const abs = Math.abs(m.amountMinor);
  const dollars = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${cents}`;
}

export const ZERO_USD: Money = money(0);
