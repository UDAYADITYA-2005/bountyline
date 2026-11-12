import { z } from 'zod';
import {
  AuditStatus,
  CheckKey,
  CheckViewStatus,
  ClaimSource,
  ClaimStatus,
  Decision,
  PayoutJobStatus,
  ReasonCode,
  UserRole,
} from './enums.js';

export const MoneyView = z.object({
  amountMinor: z.number().int(),
  currency: z.literal('USD'),
  formatted: z.string(),
});
export type MoneyView = z.infer<typeof MoneyView>;

export const CheckView = z.object({
  key: CheckKey,
  status: CheckViewStatus,
  confidence: z.number().min(0).max(1).optional(),
  label: z.string(),
  detail: z.string(),
});
export type CheckView = z.infer<typeof CheckView>;

export const ReasonView = z.object({
  code: ReasonCode,
  message: z.string(),
  checkKey: CheckKey.optional(),
});
export type ReasonView = z.infer<typeof ReasonView>;

export const ClaimView = z.object({
  id: z.string(),
  programId: z.string(),
  programName: z.string(),
  status: ClaimStatus,
  code: z.string(),
  codeExpiresAt: z.string(),
  speciesKey: z.string().optional(),
  declaredLengthCm: z.number().optional(),
  photoUrl: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number() }).optional(),
  checks: z.array(CheckView),
  decision: Decision.optional(),
  reasons: z.array(ReasonView),
  amount: MoneyView.optional(),
  payout: z
    .object({
      status: PayoutJobStatus,
      paypalItemId: z.string().optional(),
      updatedAt: z.string(),
    })
    .optional(),
  audit: AuditStatus,
  source: ClaimSource,
  scenarioId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClaimView = z.infer<typeof ClaimView>;

export const UserView = z.object({
  id: z.string(),
  email: z.string(),
  role: UserRole,
  displayName: z.string(),
  paypalEmailMasked: z.string().nullable(),
  judge: z.boolean(),
});
export type UserView = z.infer<typeof UserView>;

export const TierView = z.object({ fromCount: z.number().int(), amount: MoneyView });

export const ProgramSummary = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  modeledOn: z.object({ name: z.string(), url: z.string(), note: z.string() }),
  species: z.array(
    z.object({
      key: z.string(),
      commonName: z.string(),
      scientificName: z.string(),
      minLengthCm: z.number().nullable(),
    }),
  ),
  rewards: z.object({
    scheme: z.enum(['flat', 'cumulative_tiers']),
    tiers: z.array(TierView),
  }),
  season: z.object({ start: z.string(), end: z.string(), timezone: z.string() }),
  areaName: z.string(),
  minAge: z.number().nullable(),
  codeTtlMinutes: z.number(),
  measuringBoard: z.enum(['required', 'optional']),
});
export type ProgramSummary = z.infer<typeof ProgramSummary>;

export const DecisionLogEntry = z.object({
  id: z.number(),
  at: z.string(),
  actorType: z.enum(['system', 'manager', 'judge']),
  actorId: z.string().nullable(),
  action: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type DecisionLogEntry = z.infer<typeof DecisionLogEntry>;

export const PoolView = z.object({
  programId: z.string(),
  funded: MoneyView,
  reserved: MoneyView,
  released: MoneyView,
  available: MoneyView,
  paidToday: MoneyView,
});
export type PoolView = z.infer<typeof PoolView>;

export const ScenarioView = z.object({
  id: z.string(),
  title: z.string(),
  story: z.string(),
  programId: z.string(),
  expect: Decision,
  photoUrl: z.string(),
  realCode: z.boolean(),
});
export type ScenarioView = z.infer<typeof ScenarioView>;

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  code: z.string(),
});
export type Problem = z.infer<typeof Problem>;
