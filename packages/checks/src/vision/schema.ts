import type { VisionFindings } from '@bountyline/core';
import { z } from 'zod';

const confidence = z.number().min(0).max(1);

/** The model's observations (docs/AI_CHECKS.md). Gemini ignores length limits, so zod truncates. */
export const VisionFindingsSchema = z.object({
  species: z.object({ key: z.string().max(64), commonName: z.string().max(120), confidence }),
  length: z.object({
    cm: z.number().min(0).max(500).nullable(),
    method: z.enum(['board', 'estimate', 'none']),
    confidence,
  }),
  code: z.object({ visible: z.boolean(), text: z.string().max(32).nullable(), confidence }),
  tag: z.object({ visible: z.boolean(), text: z.string().max(64).nullable() }),
  quality: z.object({
    usable: z.boolean(),
    issues: z.array(z.enum(['blurry', 'dark', 'cropped', 'obstructed', 'no_animal'])),
  }),
  screenOrPrint: z.object({
    suspected: z.boolean(),
    confidence,
    why: z.string().max(240).nullable(),
  }),
  notes: z.string().transform((s) => s.slice(0, 240)),
});

/** JSON Schema sent to Gemini as the structured-output contract. */
export const visionJsonSchema = z.toJSONSchema(VisionFindingsSchema, {
  io: 'input',
  target: 'draft-2020-12',
});

/** Parses model output; throws on anything that doesn't match. */
export function parseFindings(value: unknown): VisionFindings {
  return VisionFindingsSchema.parse(value);
}
