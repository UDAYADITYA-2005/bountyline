CREATE TYPE "public"."actor_type" AS ENUM('system', 'manager', 'judge');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('none', 'requested', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."check_key" AS ENUM('species', 'length', 'code_in_frame', 'photo_quality', 'screen_suspected', 'duplicate', 'area', 'season', 'claim_rate', 'code_expiry');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('pass', 'fail', 'uncertain', 'skipped', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."claim_source" AS ENUM('app', 'judge_scenario');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('code_issued', 'checking', 'approved', 'held', 'rejected', 'paying', 'paid', 'payout_issue', 'expired');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('approve', 'hold', 'reject');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('funding', 'reserve', 'release');--> statement-breakpoint
CREATE TYPE "public"."payout_job_status" AS ENUM('queued', 'sending', 'sent', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('claimant', 'manager');--> statement-breakpoint
CREATE TABLE "claim_checks" (
	"claim_id" text NOT NULL,
	"check_key" "check_key" NOT NULL,
	"status" "check_status" NOT NULL,
	"confidence" real,
	"detail" text NOT NULL,
	"reason" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claim_checks_claim_id_check_key_pk" PRIMARY KEY("claim_id","check_key")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"program_version" integer NOT NULL,
	"claimant_id" text NOT NULL,
	"status" "claim_status" NOT NULL,
	"code" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"species_key" text,
	"declared_length_cm" numeric(5, 1),
	"photo_id" text,
	"lat" double precision,
	"lng" double precision,
	"location_accuracy_m" integer,
	"captured_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision" "decision",
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_minor" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" "claim_source" NOT NULL,
	"scenario_id" text,
	"judge_session_id" text,
	"audit_status" "audit_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claims_amount_nonneg" CHECK ("claims"."amount_minor" IS NULL OR "claims"."amount_minor" >= 0),
	CONSTRAINT "claims_amount_when_approved" CHECK (("claims"."status" IN ('approved','paying','paid','payout_issue')) <= ("claims"."amount_minor" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"claim_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gemini_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"requests" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_minor" integer NOT NULL,
	"claim_id" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_amount_positive" CHECK ("ledger_entries"."amount_minor" > 0),
	CONSTRAINT "ledger_claim_for_reserve" CHECK (("ledger_entries"."kind" = 'funding') = ("ledger_entries"."claim_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payout_jobs" (
	"claim_id" text PRIMARY KEY NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"sender_batch_id" text NOT NULL,
	"status" "payout_job_status" NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"receiver" text NOT NULL,
	"receiver_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"last_error" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_jobs_sender_batch_id_unique" UNIQUE("sender_batch_id"),
	CONSTRAINT "payout_jobs_amount_positive" CHECK ("payout_jobs"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"phash" bigint NOT NULL,
	"dhash" bigint NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"loaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"paypal_email" text,
	"age_attested_at" timestamp with time zone,
	"judge_session_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vision_results" (
	"photo_sha256" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vision_results_photo_sha256_model_prompt_version_pk" PRIMARY KEY("photo_sha256","model","prompt_version")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"verified" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "claim_checks" ADD CONSTRAINT "claim_checks_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_users_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_jobs" ADD CONSTRAINT "payout_jobs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_claimant_created_idx" ON "claims" USING btree ("claimant_id","created_at");--> statement-breakpoint
CREATE INDEX "claims_program_status_idx" ON "claims" USING btree ("program_id","status");--> statement-breakpoint
CREATE INDEX "claims_status_updated_idx" ON "claims" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "decision_log_claim_idx" ON "decision_log" USING btree ("claim_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_one_entry_per_kind_per_claim" ON "ledger_entries" USING btree ("claim_id","kind") WHERE "ledger_entries"."claim_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_program_idx" ON "ledger_entries" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "payout_jobs_status_next_idx" ON "payout_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "photos_sha256_idx" ON "photos" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "photos_phash_idx" ON "photos" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");