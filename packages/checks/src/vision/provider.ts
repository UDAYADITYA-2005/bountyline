import {
  pacificDay,
  type Clock,
  type VisionInput,
  type VisionProvider,
  type VisionResult,
} from '@bountyline/core';
import { getVisionCache, incrementGeminiUsage, putVisionCache, type Db } from '@bountyline/db';
import { analyzeWithRetries, type AnalyzeOptions, type VisionModel } from './gemini.js';
import { PROMPT_VERSION } from './prompt.js';
import { VisionFindingsSchema } from './schema.js';

/**
 * The app's VisionProvider: cache by (sha256, model, prompt version), then the daily quota guard,
 * then the model. With no model configured every call is `unavailable`, which holds the claim.
 */
export class CachedVisionProvider implements VisionProvider {
  constructor(
    private readonly deps: {
      db: Db;
      model: VisionModel | null;
      modelName: string;
      dailyLimit: number;
      clock: Clock;
      bypassCache?: boolean;
      analyzeOptions?: AnalyzeOptions;
    },
  ) {}

  async analyze(input: VisionInput): Promise<VisionResult> {
    const { db, model, modelName, clock } = this.deps;
    const key = { sha256: input.sha256, model: modelName, promptVersion: PROMPT_VERSION };
    if (!this.deps.bypassCache) {
      const hit = await getVisionCache(db, key);
      const parsed = hit === null ? null : VisionFindingsSchema.safeParse(hit);
      if (parsed?.success)
        return { status: 'ok', findings: parsed.data, model: modelName, cached: true };
    }
    if (!model)
      return {
        status: 'unavailable',
        reason: 'no vision model configured (GEMINI_API_KEY missing)',
      };

    const guard = async (): Promise<boolean> => {
      const count = await incrementGeminiUsage(db, pacificDay(clock.now()));
      return count <= this.deps.dailyLimit;
    };
    const result = await analyzeWithRetries(model, input, guard, this.deps.analyzeOptions);
    if (result.status !== 'ok') return result;
    await putVisionCache(db, key, result.findings, clock.now());
    return { status: 'ok', findings: result.findings, model: modelName, cached: false };
  }
}
