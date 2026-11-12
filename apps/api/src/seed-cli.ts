import { loadEnv, loadScenarioPack, repoPaths } from '@bountyline/config';
import { createDb } from '@bountyline/db';
import pino from 'pino';
import { loadProgramRegistry, systemClock, ulidGenerator } from './production.js';
import { seed } from './seed.js';

// `pnpm seed`: migrate, then seed. Safe to run any number of times.
const log = pino({ level: 'info' });
const config = loadEnv();
const paths = repoPaths();
const db = await createDb(config.DATABASE_URL, paths.root);
try {
  await db.migrate(paths.migrationsDir);
  const programs = await loadProgramRegistry(db, paths.programsDir, systemClock);
  const scenarios = loadScenarioPack(
    paths.scenariosFile,
    [...programs.values()].map((p) => p.program),
  );
  const report = await seed({
    db: db.db,
    programs,
    scenarios,
    photosDir: paths.photosDir,
    clock: systemClock,
    ids: ulidGenerator(),
    manager: { email: config.DEMO_MANAGER_EMAIL, password: config.DEMO_MANAGER_PASSWORD },
  });
  for (const w of report.warnings) log.warn(w);
  log.info(
    { manager: report.manager, funded: report.funded, history: report.history },
    'seed done',
  );
} finally {
  await db.close();
}
