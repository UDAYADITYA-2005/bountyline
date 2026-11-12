import { analyzeClaimPhoto, duplicateForClaim, runClaimChecks } from '@bountyline/checks';
import type { CheckResult, VisionResult } from '@bountyline/core';
import { task } from '@renderinc/sdk/workflows';
import { checkDeps } from './deps.js';

const retry = { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 };

/** Subtask: one Gemini call for the claim photo (cached by hash, quota guarded). */
export const analyzePhoto = task(
  { name: 'analyzePhoto', plan: 'starter', timeoutSeconds: 60, retry },
  async (_ctx, claimId: string): Promise<VisionResult> => {
    const { deps } = await checkDeps();
    return analyzeClaimPhoto(deps, claimId);
  },
);

/** Subtask: pHash and SHA-256 duplicate search in Postgres. */
export const findDuplicates = task(
  { name: 'findDuplicates', plan: 'starter', timeoutSeconds: 60, retry },
  async (_ctx, claimId: string): Promise<CheckResult> => {
    const { deps } = await checkDeps();
    return duplicateForClaim(deps, claimId);
  },
);

/**
 * Root task: runs the two subtasks in parallel on their own compute, the pure checks itself, then
 * the same decision writer the inline runner uses. Safe to retry: a decided claim is skipped.
 */
export const runClaimChecksTask = task(
  { name: 'runClaimChecks', plan: 'starter', timeoutSeconds: 120, retry },
  async (ctx, claimId: string) => {
    const { deps } = await checkDeps();
    const [vision, duplicate] = await Promise.all([
      ctx.run(analyzePhoto, claimId),
      ctx.run(findDuplicates, claimId),
    ]);
    const result = await runClaimChecks(deps, claimId, { vision, duplicate });
    return { claimId, ...result };
  },
);
