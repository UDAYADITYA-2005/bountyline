import type { Program } from '@bountyline/core';
import { loadPrograms, repoPaths } from '@bountyline/config';
import type { Db } from '../src/client.js';
import { insertClaim } from '../src/repos/claims.js';
import { upsertPrograms } from '../src/repos/programs.js';
import { createUser } from '../src/repos/users.js';
import { SYSTEM } from '../src/types.js';

export const NOW = new Date('2026-11-11T18:00:00Z');

export function demoPrograms(): Program[] {
  return loadPrograms(repoPaths().programsDir);
}

let n = 0;
export function nextId(prefix = 'T'): string {
  n += 1;
  return `${prefix}${String(n).padStart(25, '0')}`;
}

export async function seedBasics(db: Db) {
  await upsertPrograms(db, demoPrograms(), NOW);
  const user = await createUser(db, {
    id: nextId('U'),
    email: `angler${n}@example.com`,
    role: 'claimant',
    displayName: 'Angler',
    paypalEmail: `angler${n}@example.com`,
    createdAt: NOW,
  });
  return { user };
}

export async function makeClaim(
  db: Db,
  claimantId: string,
  overrides: Partial<Parameters<typeof insertClaim>[1]> = {},
) {
  return insertClaim(
    db,
    {
      id: nextId('C'),
      programId: 'columbia-pikeminnow',
      programVersion: 1,
      claimantId,
      status: 'code_issued',
      code: 'K7-42',
      codeExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
      source: 'app',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
    SYSTEM,
  );
}
