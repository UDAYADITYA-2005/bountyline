import { loadEnv, loadPrograms, repoPaths } from '@bountyline/config';
import {
  CachedVisionProvider,
  GeminiVisionModel,
  type CheckDeps,
  type ProgramEntry,
} from '@bountyline/checks';
import { createDb, upsertPrograms, type DbHandle } from '@bountyline/db';

const clock = { now: () => new Date() };

let cached: Promise<{ deps: CheckDeps; db: DbHandle }> | null = null;

/** Check dependencies for a workflow task instance. No PayPal: workflows never move money. */
export function checkDeps(): Promise<{ deps: CheckDeps; db: DbHandle }> {
  cached ??= (async () => {
    const config = loadEnv();
    const paths = repoPaths();
    const db = await createDb(config.DATABASE_URL, paths.root);
    const rows = await upsertPrograms(db.db, loadPrograms(paths.programsDir), clock.now());
    const programs = new Map<string, ProgramEntry>(
      rows.map((r) => [r.id, { program: r.program, version: r.version }]),
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
    return { db, deps: { db: db.db, vision, programs, clock, judgeMode: config.JUDGE_MODE } };
  })();
  return cached;
}
