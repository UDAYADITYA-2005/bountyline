import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from './client.js';

/** The migrations folder when running from source (tests, tsx scripts). */
export const SOURCE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** A fresh in-memory PGlite (Postgres 17) with every migration applied. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb('pglite://memory');
  await handle.migrate(SOURCE_MIGRATIONS_DIR);
  return handle;
}
