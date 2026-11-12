import { VISION_CHECK_KEYS, type CheckKey, type ReasonCode } from '@bountyline/contracts';
import type { DecisionPolicy } from '../program/program.js';
import { ALL_CHECK_KEYS, type CheckResult } from './check-result.js';

export type Outcome = 'approve' | 'hold' | 'reject';

export interface DecidedReason {
  code: ReasonCode;
  checkKey?: CheckKey | undefined;
}

export interface DecideResult {
  outcome: Outcome;
  reasons: DecidedReason[];
}

/** Default outcome per reason code (docs/AI_CHECKS.md, decision policy). */
export const DEFAULT_POLICY: Readonly<Partial<Record<ReasonCode, 'hold' | 'reject'>>> = {
  duplicate_exact: 'reject',
  wrong_species: 'reject',
  below_min_length: 'reject',
  out_of_season: 'reject',
  code_expired: 'reject',
  duplicate_near: 'hold',
  species_uncertain: 'hold',
  length_uncertain: 'hold',
  code_missing: 'hold',
  code_mismatch: 'hold',
  outside_area: 'hold',
  low_location_accuracy: 'hold',
  claim_rate_exceeded: 'hold',
  photo_unusable: 'hold',
  screen_suspected: 'hold',
  ai_unavailable: 'hold',
  check_error: 'hold',
  pool_insufficient: 'hold',
  daily_payout_cap: 'hold',
};

function reasonFor(check: CheckResult): ReasonCode | null {
  switch (check.status) {
    case 'pass':
      return null;
    case 'skipped':
      // Only the code check on a Judge sample photo may be skipped; anything else is an error.
      return check.key === 'code_in_frame' ? null : 'check_error';
    case 'unavailable':
      return VISION_CHECK_KEYS.includes(check.key) ? 'ai_unavailable' : 'check_error';
    case 'fail':
    case 'uncertain':
      return check.reason ?? 'check_error';
  }
}

/**
 * Decides a claim from its check results. Any reject reason rejects; otherwise any hold reason
 * holds; otherwise approve. A missing, errored, unavailable or uncertain check never approves.
 */
export function decide(input: {
  policy: Pick<DecisionPolicy, 'overrides'>;
  checks: readonly CheckResult[];
}): DecideResult {
  const byKey = new Map<CheckKey, CheckResult>();
  for (const c of input.checks) byKey.set(c.key, c);

  const reasons: DecidedReason[] = [];
  for (const key of ALL_CHECK_KEYS) {
    const check = byKey.get(key);
    if (!check) {
      reasons.push({ code: 'check_error', checkKey: key });
      continue;
    }
    const code = reasonFor(check);
    if (code) reasons.push({ code, checkKey: key });
  }

  const outcomeOf = (code: ReasonCode): 'hold' | 'reject' =>
    input.policy.overrides[code] ?? DEFAULT_POLICY[code] ?? 'hold';

  const unique = dedupe(reasons);
  if (unique.some((r) => outcomeOf(r.code) === 'reject')) {
    return { outcome: 'reject', reasons: unique };
  }
  if (unique.length > 0) return { outcome: 'hold', reasons: unique };
  return { outcome: 'approve', reasons: [] };
}

function dedupe(reasons: DecidedReason[]): DecidedReason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    const k = `${r.code}:${r.checkKey ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
