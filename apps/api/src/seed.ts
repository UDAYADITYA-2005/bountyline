import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ScenarioPack } from '@bountyline/config';
import { money, type Clock, type IdGenerator } from '@bountyline/core';
import { ingestPhoto, type ProgramEntry } from '@bountyline/checks';
import {
  addFunding,
  createUser,
  enqueuePayout,
  findClaimByScenario,
  findUserByEmail,
  hasFundingFrom,
  insertClaim,
  insertPhoto,
  markJob,
  reserve,
  transitionClaim,
  updateUserPassword,
  SYSTEM,
  type Db,
} from '@bountyline/db';
import { hashPassword } from './services/auth-service.js';

export interface SeedInput {
  db: Db;
  programs: ReadonlyMap<string, ProgramEntry>;
  scenarios: ScenarioPack | null;
  photosDir: string;
  clock: Clock;
  ids: IdGenerator;
  manager: { email: string; password: string | undefined };
}

export interface SeedReport {
  manager: 'created' | 'updated' | 'exists' | 'skipped (DEMO_MANAGER_PASSWORD missing)';
  funded: string[];
  history: string[];
  warnings: string[];
}

const HISTORY_EMAIL = 'history@bountyline.demo';

/** Idempotent seed: demo manager, pool funding per program, and the paid history claim(s). */
export async function seed(input: SeedInput): Promise<SeedReport> {
  const { db, clock, ids } = input;
  const now = clock.now();
  const report: SeedReport = { manager: 'exists', funded: [], history: [], warnings: [] };

  const existing = await findUserByEmail(db, input.manager.email);
  if (!input.manager.password) {
    report.manager = existing ? 'exists' : 'skipped (DEMO_MANAGER_PASSWORD missing)';
  } else if (!existing) {
    await createUser(db, {
      id: ids.next(),
      email: input.manager.email,
      role: 'manager',
      displayName: 'Demo program manager',
      passwordHash: await hashPassword(input.manager.password),
      createdAt: now,
    });
    report.manager = 'created';
  } else if (!existing.passwordHash) {
    await updateUserPassword(db, existing.id, await hashPassword(input.manager.password));
    report.manager = 'updated';
  }

  for (const { program } of input.programs.values()) {
    if (await hasFundingFrom(db, program.id, 'seed')) continue;
    await addFunding(db, {
      programId: program.id,
      amount: money(program.funding.seedMinor),
      source: 'seed',
      now,
    });
    report.funded.push(program.id);
  }

  let historyUser = await findUserByEmail(db, HISTORY_EMAIL);
  for (const h of input.scenarios?.seedHistory ?? []) {
    const scenarioId = `seed:${h.photo}`;
    if (await findClaimByScenario(db, scenarioId)) continue;
    const file = path.join(input.photosDir, path.basename(h.photo));
    if (!existsSync(file)) {
      report.warnings.push(
        `samples/photos/${h.photo} is missing; the seeded history claim was skipped, so reused-photo will not match.`,
      );
      continue;
    }
    const entry = input.programs.get(h.programId);
    if (!entry) continue;
    historyUser ??= await createUser(db, {
      id: ids.next(),
      email: HISTORY_EMAIL,
      role: 'claimant',
      displayName: 'Seeded angler',
      paypalEmail: 'history@example.com',
      ageAttestedAt: now,
      createdAt: now,
    });
    const claimant = historyUser;
    const at = new Date(now.getTime() - h.daysAgo * 24 * 3600_000);
    const photo = await ingestPhoto(readFileSync(file));
    await db.transaction(async (tx) => {
      const stored = await insertPhoto(tx, {
        id: ids.next(),
        sha256: photo.sha256,
        phash: photo.phash,
        dhash: photo.dhash,
        mime: 'image/jpeg',
        width: photo.width,
        height: photo.height,
        bytes: photo.jpeg,
        sample: true,
        createdAt: at,
      });
      const claim = await insertClaim(
        tx,
        {
          id: ids.next(),
          programId: h.programId,
          programVersion: entry.version,
          claimantId: claimant.id,
          status: 'checking',
          code: 'SD-22',
          codeExpiresAt: at,
          speciesKey: h.declared.speciesKey,
          declaredLengthCm: h.declared.lengthCm ?? null,
          photoId: stored.id,
          lat: h.location.lat,
          lng: h.location.lng,
          locationAccuracyM: h.location.accuracyM,
          capturedAt: at,
          submittedAt: at,
          source: 'judge_scenario',
          scenarioId,
          judgeSessionId: null,
          createdAt: at,
          updatedAt: at,
        },
        SYSTEM,
      );
      const amount =
        entry.program.rewards.scheme === 'flat'
          ? entry.program.rewards.amountMinor
          : (entry.program.rewards.tiers[0]?.amountMinor ?? 600);
      const step = (
        event: Parameters<typeof transitionClaim>[1]['event'],
        action: string,
        patch = {},
      ) =>
        transitionClaim(tx, {
          claimId: claim.id,
          event,
          now: at,
          actor: SYSTEM,
          action,
          data: { seeded: true },
          patch,
        });
      await step('decide_approve', 'decided', {
        decision: 'approve',
        amountMinor: amount,
        decidedAt: at,
      });
      await reserve(tx, {
        programId: h.programId,
        claimId: claim.id,
        amount: money(amount),
        source: 'seed',
        now: at,
      });
      await enqueuePayout(tx, {
        claimId: claim.id,
        receiver: 'history@example.com',
        receiverKey: 'history@example.com',
        amountMinor: amount,
        now: at,
      });
      await step('dispatch', 'payout_sent');
      await step('paid', 'paid');
      await markJob(tx, claim.id, { status: 'succeeded', paypalBatchId: 'SEEDED', updatedAt: at });
    });
    report.history.push(scenarioId);
  }
  return report;
}
