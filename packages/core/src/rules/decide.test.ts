import { ReasonCode, type CheckKey, type CheckStatus } from '@bountyline/contracts';
import { describe, expect, it } from 'vitest';
import { ALL_CHECK_KEYS, type CheckResult } from './check-result.js';
import { DEFAULT_POLICY, decide } from './decide.js';

const policy = { overrides: {} };

function allPass(): CheckResult[] {
  return ALL_CHECK_KEYS.map((key) => ({ key, status: 'pass', detail: 'ok' }));
}

function withCheck(key: CheckKey, status: CheckStatus, reason?: ReasonCode): CheckResult[] {
  return allPass().map((c) => (c.key === key ? { key, status, detail: 'x', reason } : c));
}

const REASON_TABLE: [CheckKey, ReasonCode, 'hold' | 'reject'][] = [
  ['duplicate', 'duplicate_exact', 'reject'],
  ['duplicate', 'duplicate_near', 'hold'],
  ['species', 'wrong_species', 'reject'],
  ['species', 'species_uncertain', 'hold'],
  ['length', 'below_min_length', 'reject'],
  ['length', 'length_uncertain', 'hold'],
  ['code_in_frame', 'code_missing', 'hold'],
  ['code_in_frame', 'code_mismatch', 'hold'],
  ['code_expiry', 'code_expired', 'reject'],
  ['area', 'outside_area', 'hold'],
  ['area', 'low_location_accuracy', 'hold'],
  ['season', 'out_of_season', 'reject'],
  ['claim_rate', 'claim_rate_exceeded', 'hold'],
  ['photo_quality', 'photo_unusable', 'hold'],
  ['screen_suspected', 'screen_suspected', 'hold'],
  ['species', 'ai_unavailable', 'hold'],
  ['area', 'check_error', 'hold'],
];

describe('decide', () => {
  it('approves when every check passes', () => {
    expect(decide({ policy, checks: allPass() })).toEqual({ outcome: 'approve', reasons: [] });
  });

  it.each(REASON_TABLE)('%s with %s gives %s', (key, reason, outcome) => {
    const result = decide({ policy, checks: withCheck(key, 'fail', reason) });
    expect(result.outcome).toBe(outcome);
    expect(result.reasons).toEqual([{ code: reason, checkKey: key }]);
  });

  it('covers every claim-level reason code in the default policy', () => {
    const notDecisionReasons: ReasonCode[] = [
      'manager_approved',
      'manager_rejected',
      'payout_failed',
      'payout_unclaimed',
    ];
    for (const code of ReasonCode.options) {
      if (notDecisionReasons.includes(code)) continue;
      expect(DEFAULT_POLICY[code], code).toBeDefined();
    }
  });

  it('lets a reject reason beat a hold reason', () => {
    const checks = withCheck('area', 'fail', 'outside_area').map((c) =>
      c.key === 'duplicate'
        ? { ...c, status: 'fail' as const, reason: 'duplicate_exact' as const }
        : c,
    );
    const r = decide({ policy, checks });
    expect(r.outcome).toBe('reject');
    expect(r.reasons.map((x) => x.code).sort()).toEqual(['duplicate_exact', 'outside_area']);
  });

  it.each(ALL_CHECK_KEYS)('holds when the %s check is missing', (key) => {
    const r = decide({ policy, checks: allPass().filter((c) => c.key !== key) });
    expect(r).toEqual({ outcome: 'hold', reasons: [{ code: 'check_error', checkKey: key }] });
  });

  it('holds with ai_unavailable when a vision check is unavailable', () => {
    const r = decide({ policy, checks: withCheck('species', 'unavailable') });
    expect(r).toEqual({
      outcome: 'hold',
      reasons: [{ code: 'ai_unavailable', checkKey: 'species' }],
    });
  });

  it('holds with check_error when a deterministic check is unavailable', () => {
    const r = decide({ policy, checks: withCheck('duplicate', 'unavailable') });
    expect(r.reasons).toEqual([{ code: 'check_error', checkKey: 'duplicate' }]);
  });

  it('holds when an uncertain check carries no reason', () => {
    expect(decide({ policy, checks: withCheck('length', 'uncertain') }).outcome).toBe('hold');
  });

  it('allows the code check to be skipped (Judge sample photo)', () => {
    expect(decide({ policy, checks: withCheck('code_in_frame', 'skipped') }).outcome).toBe(
      'approve',
    );
  });

  it('refuses a skipped check other than the code check', () => {
    const r = decide({ policy, checks: withCheck('species', 'skipped') });
    expect(r).toEqual({ outcome: 'hold', reasons: [{ code: 'check_error', checkKey: 'species' }] });
  });

  it('applies program overrides', () => {
    const r = decide({
      policy: { overrides: { outside_area: 'reject' } },
      checks: withCheck('area', 'fail', 'outside_area'),
    });
    expect(r.outcome).toBe('reject');
  });

  it('never approves when the checks list is empty', () => {
    expect(decide({ policy, checks: [] }).outcome).toBe('hold');
  });
});
