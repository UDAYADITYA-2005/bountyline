import type { Money } from '@bountyline/core';

/** Converts integer cents to PayPal's decimal string ("8.00") with integer math only. */
export function toPayPalValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError(`amountMinor must be a non-negative integer, got ${amountMinor}`);
  }
  const units = Math.trunc(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  return `${units}.${cents}`;
}

/** The PayPal amount object for a Money value. */
export function toPayPalAmount(m: Money): { value: string; currency: string } {
  return { value: toPayPalValue(m.amountMinor), currency: m.currency };
}

/** Masks an email for logs: "angler@example.com" becomes "a***@example.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
