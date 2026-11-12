import type { CheckKey, ReasonCode } from '@bountyline/contracts';
import type * as s from './schema.js';

export interface StoredReason {
  code: ReasonCode;
  message: string;
  checkKey?: CheckKey | undefined;
}

type ClaimRow = typeof s.claims.$inferSelect;
export type ClaimRecord = Omit<ClaimRow, 'reasons'> & { reasons: StoredReason[] };
export type UserRecord = typeof s.users.$inferSelect;
export type PhotoRecord = typeof s.photos.$inferSelect;
export type PayoutJobRecord = typeof s.payoutJobs.$inferSelect;
export type CheckRecord = typeof s.claimChecks.$inferSelect;
export type LedgerRecord = typeof s.ledgerEntries.$inferSelect;
export type DecisionLogRecord = typeof s.decisionLog.$inferSelect;
export type WebhookEventRecord = typeof s.webhookEvents.$inferSelect;

export interface Actor {
  type: 'system' | 'manager' | 'judge';
  id: string | null;
}

export const SYSTEM: Actor = { type: 'system', id: null };

export function toClaimRecord(row: ClaimRow): ClaimRecord {
  return { ...row, reasons: Array.isArray(row.reasons) ? (row.reasons as StoredReason[]) : [] };
}
