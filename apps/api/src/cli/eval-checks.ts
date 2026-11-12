import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, loadScenarioPack, repoPaths } from '@bountyline/config';
import { SeededRandom } from '@bountyline/core';
import { CachedVisionProvider, GeminiVisionModel } from '@bountyline/checks';
import { createTestDb, getClaim, listChecks } from '@bountyline/db';
import { buildApp } from '../app.js';
import type { AppDeps } from '../deps.js';
import { loadProgramRegistry, systemClock, ulidGenerator } from '../production.js';
import { InlineCheckRunner } from '../runners.js';
import { seed } from '../seed.js';
import { argValue } from './http.js';

// `pnpm eval:checks [--runs 10] [--scenario <id>] [--no-cache]`: real Gemini over the scenario pack,
// real deterministic checks and rules, in a throwaway in-memory database. Spends quota (ask first).
const runs = Number(argValue('runs') ?? '1');
const only = argValue('scenario');
const noCache = process.argv.includes('--no-cache');
const config = loadEnv();
if (!config.GEMINI_API_KEY) {
  process.stderr.write('GEMINI_API_KEY is not set; the eval needs the real model.\n');
  process.exit(1);
}
const paths = repoPaths();
const db = await createTestDb();
const programs = await loadProgramRegistry(db, paths.programsDir, systemClock);
const scenarios = loadScenarioPack(
  paths.scenariosFile,
  [...programs.values()].map((p) => p.program),
);
const vision = new CachedVisionProvider({
  db: db.db,
  model: new GeminiVisionModel(config.GEMINI_API_KEY, config.GEMINI_MODEL),
  modelName: config.GEMINI_MODEL,
  dailyLimit: config.GEMINI_DAILY_REQUEST_LIMIT,
  clock: systemClock,
  bypassCache: noCache,
});
const ids = ulidGenerator();
const deps: AppDeps = {
  config: { ...config, JUDGE_MODE: true },
  db,
  programs,
  scenarios,
  photosDir: paths.photosDir,
  payoutGateway: null,
  vision,
  checkRunner: { name: 'inline', start: async () => undefined },
  clock: systemClock,
  random: new SeededRandom(1),
  ids,
  getCert: async () => '',
  webDist: null,
  version: 'eval',
  rateLimits: false,
  logger: false,
};
const { app, services } = await buildApp(deps);
deps.checkRunner = new InlineCheckRunner(
  { db: db.db, vision, programs, clock: systemClock, judgeMode: true },
  app.log,
  true,
);
const report = await seed({
  db: db.db,
  programs,
  scenarios,
  photosDir: paths.photosDir,
  clock: systemClock,
  ids,
  manager: { email: 'eval@bountyline.demo', password: undefined },
});
for (const w of report.warnings) process.stderr.write(`warning: ${w}\n`);

interface Row {
  scenario: string;
  expect: string;
  run: number;
  outcome: string;
  reasons: string[];
  species: string;
}
const rows: Row[] = [];
const pack = scenarios.scenarios.filter((s) => !only || s.id === only);
for (let run = 1; run <= runs; run += 1) {
  for (const s of pack) {
    // A fresh judge session per run, so the duplicate check sees only the seeded history.
    const { user } = await services.judge.createSession('claimant');
    let outcome = 'error';
    let reasons: string[] = [];
    let species = '';
    try {
      const claim = await services.judge.run(user, s.id);
      const decided = await getClaim(db.db, claim.id);
      outcome = decided?.decision ?? decided?.status ?? 'error';
      reasons = decided?.reasons.map((r) => r.code) ?? [];
      species =
        (await listChecks(db.db, claim.id)).find((c) => c.checkKey === 'species')?.detail ?? '';
    } catch (e) {
      reasons = [(e as Error).message];
    }
    rows.push({ scenario: s.id, expect: s.expect, run, outcome, reasons, species });
    process.stdout.write(
      `${s.id.padEnd(20)} run ${run}: expected ${s.expect.padEnd(7)} got ${outcome.padEnd(7)} ${reasons.join(', ')} | ${species}\n`,
    );
  }
}

const summary = pack.map((s) => {
  const mine = rows.filter((r) => r.scenario === s.id);
  const hits = mine.filter((r) => r.outcome === s.expect).length;
  return { scenario: s.id, expect: s.expect, passed: hits, runs: mine.length };
});
process.stdout.write('\n| Scenario | Expected | Passed |\n|---|---|---|\n');
for (const r of summary)
  process.stdout.write(`| ${r.scenario} | ${r.expect} | ${r.passed}/${r.runs} |\n`);
mkdirSync(path.join(paths.root, 'eval'), { recursive: true });
const file = path.join(
  paths.root,
  'eval',
  `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
writeFileSync(
  file,
  JSON.stringify({ model: config.GEMINI_MODEL, runs, noCache, rows, summary }, null, 2),
);
process.stdout.write(`\nResults: ${path.relative(paths.root, file)}\n`);
await app.close();
await db.close();
process.exit(summary.every((r) => r.passed === r.runs) ? 0 : 1);
