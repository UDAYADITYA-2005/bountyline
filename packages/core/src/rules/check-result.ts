import type { CheckKey, CheckStatus, ReasonCode } from '@bountyline/contracts';

/** The output of one check, vision-based or deterministic. */
export interface CheckResult {
  key: CheckKey;
  status: CheckStatus;
  confidence?: number | undefined;
  detail: string;
  /** The reason this check contributes when it does not pass. */
  reason?: ReasonCode | undefined;
  evidence?: Record<string, unknown> | undefined;
}

export const ALL_CHECK_KEYS: readonly CheckKey[] = [
  'species',
  'length',
  'code_in_frame',
  'photo_quality',
  'screen_suspected',
  'duplicate',
  'area',
  'season',
  'claim_rate',
  'code_expiry',
];
