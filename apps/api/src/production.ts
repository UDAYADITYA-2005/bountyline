import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPrograms, loadScenarioPack, repoPaths, type AppConfig } from '@bountyline/config';
import type { Clock, IdGenerator, Random } from '@bountyline/core';
import {
  CachedVisionProvider,
  GeminiVisionModel,
  type CheckDeps,
  type ProgramEntry,
} from '@bountyline/checks';
import { createDb, upsertPrograms, type DbHandle } from '@bountyline/db';
import { createCertFetcher, createPayPalClient } from '@bountyline/paypal';
import type { FastifyBaseLogger } from 'fastify';
import { monotonicFactory } from 'ulid';
import type { AppDeps, CheckRunner } from './deps.js';
import { InlineCheckRunner, RenderWorkflowsCheckRunner } from './runners.js';

export const systemClock: Clock = { now: () => new Date() };
export const systemRandom: Random = { next: () => Math.random() };

export function ulidGenerator(): IdGenerator {
  const next = monotonicFactory();
  return { next: () => next() };
}

export function appVersion(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'apps', 'api', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Loads program files, stores them (bumping versions on change), and returns the registry. */
export async function loadProgramRegistry(
  db: DbHandle,
  programsDir: string,
  clock: Clock,
): Promise<Map<string, ProgramEntry>> {
  const rows = await upsertPrograms(db.db, loadPrograms(programsDir), clock.now());
  return new Map(rows.map((r) => [r.id, { program: r.program, version: r.version }]));
}

/** Render Workflows when configured with a key, otherwise inline (ADR 0005). */
export function chooseCheckRunner(
  config: AppConfig,
  checkDeps: CheckDeps,
  log: FastifyBaseLogger,
): CheckRunner {
  const inline = new InlineCheckRunner(checkDeps, log);
  if (config.CHECK_RUNNER !== 'render') return inline;
  if (!config.RENDER_API_KEY) {
    log.warn('CHECK_RUNNER=render but RENDER_API_KEY is missing: running checks inline');
    return inline;
  }
  return new RenderWorkflowsCheckRunner(
    config.RENDER_API_KEY,
    `${config.RENDER_WORKFLOW_SLUG}/runClaimChecks`,
    inline,
    checkDeps,
    log,
  );
}

/** Wires real adapters from config. The model and PayPal are optional so the app boots without keys. */
export async function createProductionDeps(
  config: AppConfig,
  log: FastifyBaseLogger,
): Promise<AppDeps> {
  const paths = repoPaths();
  const clock = systemClock;
  const db = await createDb(config.DATABASE_URL, paths.root);
  const programs = await loadProgramRegistry(db, paths.programsDir, clock);
  const scenarios = loadScenarioPack(
    paths.scenariosFile,
    [...programs.values()].map((p) => p.program),
  );

  const vision = new CachedVisionProvider({
    db: db.db,
    model: config.GEMINI_API_KEY
      ? new GeminiVisionModel(config.GEMINI_API_KEY, config.GEMINI_MODEL)
      : null,
    modelName: config.GEMINI_MODEL,
    dailyLimit: config.GEMINI_DAILY_REQUEST_LIMIT,
    clock,
  });

  const payoutGateway =
    config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET
      ? createPayPalClient({
          baseUrl: config.paypalBaseUrl,
          clientId: config.PAYPAL_CLIENT_ID,
          clientSecret: config.PAYPAL_CLIENT_SECRET,
          clock,
        }).gateway
      : null;
  if (!payoutGateway)
    log.warn('PayPal credentials missing: approved claims stay queued until they are set');
  if (!config.GEMINI_API_KEY)
    log.warn('GEMINI_API_KEY missing: photo checks are unavailable, so claims are held');

  const checkDeps = { db: db.db, vision, programs, clock, judgeMode: config.JUDGE_MODE };
  const checkRunner = chooseCheckRunner(config, checkDeps, log);

  return {
    config,
    db,
    programs,
    scenarios,
    photosDir: paths.photosDir,
    payoutGateway,
    vision,
    checkRunner,
    clock,
    random: systemRandom,
    ids: ulidGenerator(),
    getCert: createCertFetcher(),
    webDist: config.isProduction ? paths.webDist : null,
    version: appVersion(paths.root),
  };
}
