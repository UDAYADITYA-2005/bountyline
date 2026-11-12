import { z } from 'zod';

export const ClaimStatus = z.enum([
  'code_issued',
  'checking',
  'approved',
  'held',
  'rejected',
  'paying',
  'paid',
  'payout_issue',
  'expired',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const FINAL_CLAIM_STATUSES: readonly ClaimStatus[] = ['paid', 'rejected', 'expired'];

export const Decision = z.enum(['approve', 'hold', 'reject']);
export type Decision = z.infer<typeof Decision>;

export const CheckKey = z.enum([
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
]);
export type CheckKey = z.infer<typeof CheckKey>;

export const VISION_CHECK_KEYS: readonly CheckKey[] = [
  'species',
  'length',
  'code_in_frame',
  'photo_quality',
  'screen_suspected',
];

export const CheckStatus = z.enum(['pass', 'fail', 'uncertain', 'skipped', 'unavailable']);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckViewStatus = z.enum([
  'pending',
  'pass',
  'fail',
  'uncertain',
  'skipped',
  'unavailable',
]);
export type CheckViewStatus = z.infer<typeof CheckViewStatus>;

export const ReasonCode = z.enum([
  'duplicate_exact',
  'duplicate_near',
  'wrong_species',
  'species_uncertain',
  'below_min_length',
  'length_uncertain',
  'code_missing',
  'code_mismatch',
  'code_expired',
  'outside_area',
  'low_location_accuracy',
  'out_of_season',
  'claim_rate_exceeded',
  'photo_unusable',
  'screen_suspected',
  'ai_unavailable',
  'check_error',
  'pool_insufficient',
  'daily_payout_cap',
  'manager_approved',
  'manager_rejected',
  'payout_failed',
  'payout_unclaimed',
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const ErrorCode = z.enum([
  'CLAIM_NOT_FOUND',
  'PROGRAM_NOT_FOUND',
  'PHOTO_NOT_FOUND',
  'SCENARIO_NOT_FOUND',
  'CODE_EXPIRED',
  'INVALID_STATE',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'JUDGE_MODE_OFF',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'NOT_ELIGIBLE',
  'PHOTO_INVALID',
  'NOT_FOUND',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const AuditStatus = z.enum(['none', 'requested', 'passed', 'failed']);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const PayoutJobStatus = z.enum(['queued', 'sending', 'sent', 'succeeded', 'failed']);
export type PayoutJobStatus = z.infer<typeof PayoutJobStatus>;

export const UserRole = z.enum(['claimant', 'manager']);
export type UserRole = z.infer<typeof UserRole>;

export const ClaimSource = z.enum(['app', 'judge_scenario']);
export type ClaimSource = z.infer<typeof ClaimSource>;

export const LedgerKind = z.enum(['funding', 'reserve', 'release']);
export type LedgerKind = z.infer<typeof LedgerKind>;

export const ActorType = z.enum(['system', 'manager', 'judge']);
export type ActorType = z.infer<typeof ActorType>;

export const LogAction = z.enum([
  'created',
  'evidence_submitted',
  'decided',
  'manager_decision',
  'payout_sent',
  'paid',
  'payout_issue',
  'expired',
  'audit_requested',
  'audit_resolved',
]);
export type LogAction = z.infer<typeof LogAction>;
