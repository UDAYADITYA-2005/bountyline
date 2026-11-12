import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../ports/ports.js';
import { CODE_ALPHABET, codesMatch, generateCode, normalizeCode } from './code.js';

describe('one-time codes', () => {
  it('uses the XX-NN format without ambiguous characters', () => {
    const random = new SeededRandom(42);
    for (let i = 0; i < 500; i += 1) {
      const code = generateCode(random);
      expect(code).toMatch(/^[A-Z2-9]{2}-[A-Z2-9]{2}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
    expect(CODE_ALPHABET).toHaveLength(32);
  });

  it('is deterministic for a seed', () => {
    expect(generateCode(new SeededRandom(7))).toBe(generateCode(new SeededRandom(7)));
  });

  it.each([
    ['k7-42', 'K7-42', true],
    [' K7 - 42 ', 'K7-42', true],
    ['K7-43', 'K7-42', false],
    ['K742', 'K7-42', false],
  ])('compares %j with %j as %s', (read, issued, same) => {
    expect(codesMatch(read, issued)).toBe(same);
  });

  it('normalises case and spaces', () => {
    expect(normalizeCode('a b-c d')).toBe('AB-CD');
  });
});
