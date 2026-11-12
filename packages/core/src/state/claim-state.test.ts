import { ClaimStatus } from '@bountyline/contracts';
import { describe, expect, it } from 'vitest';
import { allTransitions, isFinal, transition, type ClaimEvent } from './claim-state.js';

const EVENTS: ClaimEvent[] = [
  'evidence',
  'expire',
  'decide_approve',
  'decide_hold',
  'decide_reject',
  'manager_approve',
  'manager_reject',
  'dispatch',
  'paid',
  'payout_failed',
];

const LEGAL: [ClaimStatus, ClaimEvent, ClaimStatus][] = [
  ['code_issued', 'evidence', 'checking'],
  ['code_issued', 'expire', 'expired'],
  ['checking', 'decide_approve', 'approved'],
  ['checking', 'decide_hold', 'held'],
  ['checking', 'decide_reject', 'rejected'],
  ['held', 'manager_approve', 'approved'],
  ['held', 'manager_reject', 'rejected'],
  ['approved', 'dispatch', 'paying'],
  ['approved', 'paid', 'paid'],
  ['approved', 'payout_failed', 'payout_issue'],
  ['paying', 'paid', 'paid'],
  ['paying', 'payout_failed', 'payout_issue'],
  ['payout_issue', 'manager_approve', 'approved'],
  ['payout_issue', 'manager_reject', 'rejected'],
  ['payout_issue', 'paid', 'paid'],
];

describe('claim state machine', () => {
  it.each(LEGAL)('moves %s --%s--> %s', (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it('has exactly the documented arrows', () => {
    expect(allTransitions()).toHaveLength(LEGAL.length);
  });

  const legalKeys = new Set(LEGAL.map(([f, e]) => `${f}:${e}`));
  const illegal = ClaimStatus.options.flatMap((s) =>
    EVENTS.filter((e) => !legalKeys.has(`${s}:${e}`)).map((e) => [s, e] as const),
  );

  it.each(illegal)('refuses %s --%s with INVALID_STATE', (from, event) => {
    expect(() => transition(from, event)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
  });

  it.each(['paid', 'rejected', 'expired'] as const)('never moves the final state %s', (s) => {
    expect(isFinal(s)).toBe(true);
    for (const e of EVENTS) expect(() => transition(s, e)).toThrow();
  });

  it('treats non-final states as non-final', () => {
    expect(isFinal('paying')).toBe(false);
    expect(isFinal('payout_issue')).toBe(false);
  });
});
