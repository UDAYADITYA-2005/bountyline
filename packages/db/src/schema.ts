import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Enums mirror the zod enums in @bountyline/contracts (db/src/enums.test.ts keeps them in sync).
export const userRole = pgEnum('user_role', ['claimant', 'manager']);
export const claimStatus = pgEnum('claim_status', [
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
export const decisionEnum = pgEnum('decision', ['approve', 'hold', 'reject']);
export const claimSource = pgEnum('claim_source', ['app', 'judge_scenario']);
export const auditStatus = pgEnum('audit_status', ['none', 'requested', 'passed', 'failed']);
export const checkKey = pgEnum('check_key', [
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
export const checkStatus = pgEnum('check_status', [
  'pass',
  'fail',
  'uncertain',
  'skipped',
  'unavailable',
]);
export const ledgerKind = pgEnum('ledger_kind', ['funding', 'reserve', 'release']);
export const payoutJobStatus = pgEnum('payout_job_status', [
  'queued',
  'sending',
  'sent',
  'succeeded',
  'failed',
]);
export const actorType = pgEnum('actor_type', ['system', 'manager', 'judge']);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  role: userRole('role').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  paypalEmail: text('paypal_email'),
  ageAttestedAt: ts('age_attested_at'),
  judgeSessionId: text('judge_session_id'),
  createdAt: ts('created_at').notNull(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const programs = pgTable('programs', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(),
  configHash: text('config_hash').notNull(),
  loadedAt: ts('loaded_at').notNull(),
});

export const photos = pgTable(
  'photos',
  {
    id: text('id').primaryKey(),
    sha256: text('sha256').notNull(),
    phash: bigint('phash', { mode: 'bigint' }).notNull(),
    dhash: bigint('dhash', { mode: 'bigint' }).notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: bytea('bytes').notNull(),
    sample: boolean('sample').notNull().default(false),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('photos_sha256_idx').on(t.sha256), index('photos_phash_idx').on(t.phash)],
);

export const claims = pgTable(
  'claims',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id),
    programVersion: integer('program_version').notNull(),
    claimantId: text('claimant_id')
      .notNull()
      .references(() => users.id),
    status: claimStatus('status').notNull(),
    code: text('code').notNull(),
    codeExpiresAt: ts('code_expires_at').notNull(),
    speciesKey: text('species_key'),
    declaredLengthCm: numeric('declared_length_cm', { precision: 5, scale: 1, mode: 'number' }),
    photoId: text('photo_id').references(() => photos.id),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    locationAccuracyM: integer('location_accuracy_m'),
    capturedAt: ts('captured_at'),
    submittedAt: ts('submitted_at'),
    decidedAt: ts('decided_at'),
    decision: decisionEnum('decision'),
    reasons: jsonb('reasons')
      .notNull()
      .default(sql`'[]'::jsonb`),
    amountMinor: integer('amount_minor'),
    currency: text('currency').notNull().default('USD'),
    source: claimSource('source').notNull(),
    scenarioId: text('scenario_id'),
    judgeSessionId: text('judge_session_id'),
    auditStatus: auditStatus('audit_status').notNull().default('none'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('claims_claimant_created_idx').on(t.claimantId, t.createdAt),
    index('claims_program_status_idx').on(t.programId, t.status),
    index('claims_status_updated_idx').on(t.status, t.updatedAt),
    check('claims_amount_nonneg', sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`),
    // Invariant 2: an amount exists exactly when the claim was approved at least once.
    check(
      'claims_amount_when_approved',
      sql`(${t.status} IN ('approved','paying','paid','payout_issue')) <= (${t.amountMinor} IS NOT NULL)`,
    ),
  ],
);

export const claimChecks = pgTable(
  'claim_checks',
  {
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    checkKey: checkKey('check_key').notNull(),
    status: checkStatus('status').notNull(),
    confidence: real('confidence'),
    detail: text('detail').notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.claimId, t.checkKey] })],
);

export const visionResults = pgTable(
  'vision_results',
  {
    photoSha256: text('photo_sha256').notNull(),
    model: text('model').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    result: jsonb('result').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.photoSha256, t.model, t.promptVersion] })],
);

export const geminiUsage = pgTable('gemini_usage', {
  day: date('day', { mode: 'string' }).primaryKey(),
  requests: integer('requests').notNull(),
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id),
    kind: ledgerKind('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    claimId: text('claim_id').references(() => claims.id),
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    check('ledger_amount_positive', sql`${t.amountMinor} > 0`),
    check('ledger_claim_for_reserve', sql`(${t.kind} = 'funding') = (${t.claimId} IS NULL)`),
    // Invariant 1 and 4: one reserve and at most one release per claim.
    uniqueIndex('ledger_one_entry_per_kind_per_claim')
      .on(t.claimId, t.kind)
      .where(sql`${t.claimId} IS NOT NULL`),
    index('ledger_program_idx').on(t.programId),
  ],
);

export const payoutJobs = pgTable(
  'payout_jobs',
  {
    claimId: text('claim_id')
      .primaryKey()
      .references(() => claims.id),
    attempt: integer('attempt').notNull().default(0),
    senderBatchId: text('sender_batch_id').notNull().unique(),
    status: payoutJobStatus('status').notNull(),
    tries: integer('tries').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull(),
    receiver: text('receiver').notNull(),
    // Key for the per-receiver daily cap: the receiver email, or email plus judge session in
    // Judge mode, where every judge pays the same sandbox account.
    receiverKey: text('receiver_key').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    paypalBatchId: text('paypal_batch_id'),
    paypalItemId: text('paypal_item_id'),
    lastError: text('last_error'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('payout_jobs_status_next_idx').on(t.status, t.nextAttemptAt),
    check('payout_jobs_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  resourceId: text('resource_id'),
  verified: boolean('verified').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: ts('received_at').notNull(),
  processedAt: ts('processed_at'),
  error: text('error'),
});

export const decisionLog = pgTable(
  'decision_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: ts('at').notNull(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('decision_log_claim_idx').on(t.claimId, t.id)],
);
