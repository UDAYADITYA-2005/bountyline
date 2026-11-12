import type { Random } from '../ports/ports.js';

/** Code alphabet without 0, O, 1 and I, which are easy to misread on a card. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A one-time code in the format XX-NN, such as K7-42. */
export function generateCode(random: Random): string {
  const pick = (): string => {
    const i = Math.floor(random.next() * CODE_ALPHABET.length);
    return CODE_ALPHABET[Math.min(i, CODE_ALPHABET.length - 1)] ?? 'A';
  };
  return `${pick()}${pick()}-${pick()}${pick()}`;
}

/** Normalises a code for comparison: upper case, no whitespace. */
export function normalizeCode(text: string): string {
  return text.toUpperCase().replace(/\s+/g, '');
}

/** True when the code read from the photo equals the issued code after normalising. */
export function codesMatch(read: string, issued: string): boolean {
  return normalizeCode(read) === normalizeCode(issued);
}
