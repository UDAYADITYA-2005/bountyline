import { loadEnv, repoPaths } from '@bountyline/config';
import { createDb } from '@bountyline/db';
import pino from 'pino';

// Applies migrations before the server starts; a failed migration fails the deploy (docs/DEPLOY.md).
const log = pino({ level: 'info' });
const config = loadEnv();
const paths = repoPaths();
const db = await createDb(config.DATABASE_URL, paths.root);
try {
  await db.migrate(paths.migrationsDir);
  log.info({ kind: db.kind }, 'migrations applied');
} finally {
  await db.close();
}
