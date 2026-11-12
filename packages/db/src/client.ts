import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** One Drizzle API over PGlite (dev, tests) and node-postgres (Render). */
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  kind: 'pglite' | 'postgres';
  migrate(migrationsFolder: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Opens a database. `pglite://<dir>` persists PGlite on disk; `pglite://memory` stays in memory. */
export async function createDb(url: string, root: string = process.cwd()): Promise<DbHandle> {
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    let client: PGlite;
    if (target === '' || target === 'memory') {
      client = new PGlite();
    } else {
      const dir = path.resolve(root, target);
      mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Db,
      kind: 'pglite',
      migrate: (migrationsFolder) => migratePglite(db, { migrationsFolder }),
      ping: async () => (await client.query('select 1 as ok')).rows.length === 1,
      close: () => client.close(),
    };
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    kind: 'postgres',
    migrate: (migrationsFolder) => migratePg(db, { migrationsFolder }),
    ping: async () => (await pool.query('select 1 as ok')).rows.length === 1,
    close: () => pool.end(),
  };
}
