import type { CheckKey } from '@bountyline/contracts';
import type { CheckResult, Clock, Program, VisionProvider, VisionResult } from '@bountyline/core';
import {
  countSubmissionsSince,
  findDuplicateCandidates,
  getClaim,
  getPhoto,
  type Db,
} from '@bountyline/db';
import { recordAutomaticDecision, type AutomaticDecision } from './decision/record.js';
import {
  areaCheck,
  claimRateCheck,
  codeExpiryCheck,
  duplicateCheck,
  seasonCheck,
} from './deterministic.js';
import { visionChecks } from './vision/mapping.js';
import { speciesHints } from './vision/prompt.js';

export interface ProgramEntry {
  program: Program;
  version: number;
}

export interface CheckDeps {
  db: Db;
  vision: VisionProvider;
  programs: ReadonlyMap<string, ProgramEntry>;
  clock: Clock;
  judgeMode: boolean;
}

export type RunResult = AutomaticDecision & { elapsedMs: number };

async function guarded(
  key: CheckKey,
  fn: () => Promise<CheckResult> | CheckResult,
): Promise<CheckResult> {
  try {
    return await fn();
  } catch (e) {
    return {
      key,
      status: 'uncertain',
      reason: 'check_error',
      detail: `Check failed: ${(e as Error).name}`,
    };
  }
}

/**
 * Runs every check for a claim in `checking`, then records the decision. Safe to call more than
 * once: a claim that has left `checking` is skipped. Used by the inline runner and by Workflows.
 */
/** Results computed elsewhere (Render Workflows subtasks) that the run should use as-is. */
export interface PrecomputedChecks {
  vision?: VisionResult;
  duplicate?: CheckResult;
}

/** The vision step alone (a Workflows subtask). */
export async function analyzeClaimPhoto(deps: CheckDeps, claimId: string): Promise<VisionResult> {
  const claim = await getClaim(deps.db, claimId);
  const entry = claim ? deps.programs.get(claim.programId) : undefined;
  const photo = claim?.photoId ? await getPhoto(deps.db, claim.photoId) : null;
  if (!claim || !entry || !photo) return { status: 'invalid', reason: 'no photo' };
  return deps.vision.analyze({
    jpeg: photo.bytes,
    sha256: photo.sha256,
    ...speciesHints(entry.program),
  });
}

/** The duplicate search alone (a Workflows subtask). */
export async function duplicateForClaim(deps: CheckDeps, claimId: string): Promise<CheckResult> {
  return guarded('duplicate', async () => {
    const claim = await getClaim(deps.db, claimId);
    const entry = claim ? deps.programs.get(claim.programId) : undefined;
    const photo = claim?.photoId ? await getPhoto(deps.db, claim.photoId) : null;
    if (!claim || !entry || !photo)
      return { key: 'duplicate', status: 'uncertain', reason: 'check_error', detail: 'No photo' };
    const candidates = await findDuplicateCandidates(deps.db, {
      claimId: claim.id,
      sha256: photo.sha256,
      phash: photo.phash,
      judgeSessionId: claim.judgeSessionId,
    });
    return duplicateCheck(candidates, entry.program.decisionPolicy);
  });
}

export async function runClaimChecks(
  deps: CheckDeps,
  claimId: string,
  pre: PrecomputedChecks = {},
): Promise<RunResult> {
  const started = deps.clock.now().getTime();
  const done = (r: AutomaticDecision): RunResult => ({
    ...r,
    elapsedMs: deps.clock.now().getTime() - started,
  });

  const claim = await getClaim(deps.db, claimId);
  if (!claim) return done({ status: 'skipped', reason: 'claim not found' });
  if (claim.status !== 'checking')
    return done({ status: 'skipped', reason: `claim is ${claim.status}` });
  const entry = deps.programs.get(claim.programId);
  if (!entry) return done({ status: 'skipped', reason: 'unknown program' });
  const { program } = entry;
  const photo = claim.photoId ? await getPhoto(deps.db, claim.photoId) : null;
  const submittedAt = claim.submittedAt ?? deps.clock.now();

  const ctx = {
    program,
    issuedCode: claim.code,
    declaredLengthCm: claim.declaredLengthCm ?? null,
    samplePhoto: photo?.sample ?? false,
    // A scenario whose photo shows its code card is ingested with sample=false.
    sampleHasRealCode: false,
  };

  const visionPromise: Promise<VisionResult> = pre.vision
    ? Promise.resolve(pre.vision)
    : photo
      ? deps.vision
          .analyze({ jpeg: photo.bytes, sha256: photo.sha256, ...speciesHints(program) })
          .catch((e: unknown) => ({ status: 'unavailable', reason: (e as Error).name }) as const)
      : Promise.resolve({ status: 'invalid', reason: 'no photo' } as const);

  const [vision, duplicate, rate] = await Promise.all([
    visionPromise,
    guarded('duplicate', async () =>
      pre.duplicate
        ? pre.duplicate
        : photo
          ? duplicateCheck(
              await findDuplicateCandidates(deps.db, {
                claimId: claim.id,
                sha256: photo.sha256,
                phash: photo.phash,
                judgeSessionId: claim.judgeSessionId,
              }),
              program.decisionPolicy,
            )
          : { key: 'duplicate', status: 'uncertain', reason: 'check_error', detail: 'No photo' },
    ),
    guarded('claim_rate', async () => {
      const prior = await countSubmissionsSince(deps.db, {
        claimantId: claim.claimantId,
        programId: claim.programId,
        since: new Date(submittedAt.getTime() - 24 * 3600_000),
        excludeClaimId: claim.id,
      });
      return claimRateCheck(prior + 1, program.limits.maxClaimsPerDay);
    }),
  ]);

  const location =
    claim.lat !== null && claim.lng !== null
      ? {
          lat: claim.lat,
          lng: claim.lng,
          accuracyM: claim.locationAccuracyM ?? Number.POSITIVE_INFINITY,
        }
      : null;

  const checks: CheckResult[] = [
    ...visionChecks(vision, ctx),
    duplicate,
    await guarded('area', () => areaCheck(location, program)),
    await guarded('season', () => seasonCheck(submittedAt, program.season)),
    rate,
    await guarded('code_expiry', () => codeExpiryCheck(submittedAt, claim.codeExpiresAt)),
  ];

  return done(
    await recordAutomaticDecision(
      { db: deps.db, clock: deps.clock, judgeMode: deps.judgeMode },
      { claimId: claim.id, program, programVersion: entry.version, checks },
    ),
  );
}
