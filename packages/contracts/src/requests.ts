import { z } from 'zod';
import { ClaimStatus } from './enums.js';
import {
  ClaimView,
  DecisionLogEntry,
  MoneyView,
  PoolView,
  ProgramSummary,
  ScenarioView,
  UserView,
} from './views.js';

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

export const RegisterBody = z.object({
  email,
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(200),
  paypalEmail: email,
  ageAttested: z.boolean(),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.object({ email, password: z.string().min(1).max(200) });
export type LoginBody = z.infer<typeof LoginBody>;

export const UserResponse = z.object({ user: UserView });

export const StartClaimBody = z.object({
  programId: z.string().min(1).max(64),
  speciesKey: z.string().min(1).max(64).optional(),
});
export type StartClaimBody = z.infer<typeof StartClaimBody>;

export const EvidenceMeta = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000),
  capturedAt: z.iso.datetime({ offset: true }),
  declaredLengthCm: z.number().positive().max(500).optional(),
});
export type EvidenceMeta = z.infer<typeof EvidenceMeta>;

export const ClaimResponse = z.object({ claim: ClaimView });
export const ClaimDetailResponse = z.object({
  claim: ClaimView,
  history: z.array(DecisionLogEntry),
});

export const MyClaimsResponse = z.object({
  claims: z.array(ClaimView),
  nextCursor: z.string().optional(),
  totals: z.object({
    paid: MoneyView,
    pending: MoneyView,
    seasonCount: z.number().int(),
    tierProgress: z
      .array(
        z.object({
          programId: z.string(),
          seasonCount: z.number().int(),
          currentAmount: MoneyView,
          nextTierAt: z.number().int().nullable(),
        }),
      )
      .optional(),
  }),
});
export type MyClaimsResponse = z.infer<typeof MyClaimsResponse>;

export const ListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const DeskClaimsQuery = ListQuery.extend({
  /** Comma-separated claim statuses, such as `held,payout_issue`. */
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()) : undefined))
    .pipe(z.array(ClaimStatus).optional()),
  programId: z.string().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const DeskClaimsResponse = z.object({
  claims: z.array(ClaimView),
  nextCursor: z.string().optional(),
});

export const DeskDecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().min(1).max(500),
});
export type DeskDecisionBody = z.infer<typeof DeskDecisionBody>;

export const DeskAuditBody = z.object({
  action: z.enum(['request', 'pass', 'fail']),
  note: z.string().trim().max(500).optional(),
});
export type DeskAuditBody = z.infer<typeof DeskAuditBody>;

export const PoolQuery = z.object({ programId: z.string().optional() });
export const PoolResponse = z.object({ pools: z.array(PoolView) });

export const DeskTable = z.enum(['claims', 'payouts', 'ledger', 'audits']);
export type DeskTable = z.infer<typeof DeskTable>;
export const DeskDataResponse = z.object({
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});

export const ProgramsResponse = z.object({ programs: z.array(ProgramSummary) });
export const ProgramResponse = z.object({ program: ProgramSummary });

export const JudgeSessionBody = z.object({ as: z.enum(['claimant', 'manager']) });
export const ScenariosResponse = z.object({ scenarios: z.array(ScenarioView) });

export const HealthResponse = z.object({
  status: z.literal('ok'),
  db: z.enum(['ok', 'skipped', 'error']),
  version: z.string(),
  judgeMode: z.boolean(),
});
