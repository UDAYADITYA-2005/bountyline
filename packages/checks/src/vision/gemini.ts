import type { VisionFindings, VisionInput } from '@bountyline/core';
import { GoogleGenAI, MediaResolution } from '@google/genai';
import { buildPrompt } from './prompt.js';
import { parseFindings, visionJsonSchema } from './schema.js';

/** One raw model call. Separate from caching and quota so both can be tested with fakes. */
export interface VisionModel {
  readonly model: string;
  call(input: VisionInput): Promise<unknown>;
}

export class RateLimitedError extends Error {
  constructor() {
    super('Gemini rate limited');
    this.name = 'RateLimitedError';
  }
}

/** Gemini through @google/genai: image first, then the prompt, JSON mode with our schema. */
export class GeminiVisionModel implements VisionModel {
  private readonly ai: GoogleGenAI;
  constructor(
    apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 20_000,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async call(input: VisionInput): Promise<unknown> {
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: Buffer.from(input.jpeg).toString('base64'),
                },
              },
              { text: buildPrompt(input) },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: visionJsonSchema,
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
          abortSignal: AbortSignal.timeout(this.timeoutMs),
        },
      });
      const text = res.text ?? '';
      return JSON.parse(text) as unknown;
    } catch (e) {
      const status = (e as { status?: unknown }).status;
      if (status === 429) throw new RateLimitedError();
      throw e;
    }
  }
}

export interface AnalyzeOptions {
  sleep?: (ms: number) => Promise<void>;
}

export type RawAnalysis =
  | { status: 'ok'; findings: VisionFindings }
  | { status: 'unavailable'; reason: string }
  | { status: 'invalid'; reason: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Calls the model with the documented retry policy: on 429 back off 1, 2 and 4 s; on output that
 * fails the schema, retry once. `beforeCall` runs before every request (the quota guard).
 */
export async function analyzeWithRetries(
  model: VisionModel,
  input: VisionInput,
  beforeCall: () => Promise<boolean>,
  opts: AnalyzeOptions = {},
): Promise<RawAnalysis> {
  const sleep = opts.sleep ?? defaultSleep;
  const backoffs = [1000, 2000, 4000];
  let parseFailures = 0;
  let rateLimits = 0;
  for (;;) {
    if (!(await beforeCall()))
      return { status: 'unavailable', reason: 'daily Gemini quota reached' };
    try {
      const raw = await model.call(input);
      try {
        return { status: 'ok', findings: parseFindings(raw) };
      } catch {
        parseFailures += 1;
        if (parseFailures >= 2)
          return { status: 'invalid', reason: 'model output did not match the schema twice' };
      }
    } catch (e) {
      if (e instanceof RateLimitedError) {
        const wait = backoffs[rateLimits];
        rateLimits += 1;
        if (wait === undefined) return { status: 'unavailable', reason: 'Gemini rate limited' };
        await sleep(wait);
        continue;
      }
      if (e instanceof SyntaxError) {
        parseFailures += 1;
        if (parseFailures >= 2)
          return { status: 'invalid', reason: 'model output was not JSON twice' };
        continue;
      }
      return { status: 'unavailable', reason: `Gemini error: ${(e as Error).name}` };
    }
  }
}
