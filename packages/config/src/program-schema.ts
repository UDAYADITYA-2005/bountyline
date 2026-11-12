import { ReasonCode } from '@bountyline/contracts';
import type { Program } from '@bountyline/core';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const cents = z.number().int().nonnegative();
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const tz = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA time zone');

const species = z.strictObject({
  key: z.string().regex(/^[a-z0-9_]+$/),
  commonName: z.string().min(1),
  scientificName: z.string().min(1),
  minLengthCm: z.number().positive().nullable(),
  traits: z.string().min(1),
});

const lookalike = z.strictObject({
  key: z.string().regex(/^[a-z0-9_]+$/),
  commonName: z.string().min(1),
  traits: z.string().min(1),
});

const rewards = z.discriminatedUnion('scheme', [
  z.strictObject({ scheme: z.literal('flat'), amountMinor: cents }),
  z.strictObject({
    scheme: z.literal('cumulative_tiers'),
    window: z.literal('season'),
    tiers: z
      .array(z.strictObject({ fromCount: z.number().int().min(1), amountMinor: cents }))
      .min(1)
      .refine((t) => t.some((x) => x.fromCount === 1), 'a tier must start at fromCount 1'),
    tagBonus: z.strictObject({ amountMinor: cents, tagList: z.array(z.string()) }).optional(),
  }),
]);

const confidence = z.number().min(0).max(1);

export const ProgramSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    summary: z.string().min(1),
    modeledOn: z.strictObject({ name: z.string(), url: z.url(), note: z.string() }),
    currency: z.literal('USD'),
    species: z.array(species).min(1),
    lookalikes: z.array(lookalike),
    evidence: z.strictObject({
      codeInFrame: z.enum(['required', 'optional']),
      measuringBoard: z.enum(['required', 'optional']),
      codeTtlMinutes: z.number().int().min(1).max(240),
      maxLocationAccuracyM: z.number().int().positive(),
    }),
    rewards,
    limits: z.strictObject({
      maxClaimsPerDay: z.number().int().positive(),
      maxPayoutMinorPerReceiverPerDay: cents,
    }),
    season: z
      .strictObject({ start: isoDate, end: isoDate, timezone: tz })
      .refine((s) => s.start <= s.end, 'season start must be on or before end'),
    eligibility: z.strictObject({ minAge: z.number().int().positive().nullable() }),
    decisionPolicy: z.strictObject({
      speciesMinConfidence: confidence,
      lengthMinConfidence: confidence,
      screenSuspectedMinConfidence: confidence,
      duplicateExactMaxDistance: z.number().int().min(0).max(64),
      duplicateNearMaxDistance: z.number().int().min(0).max(64),
      overrides: z.partialRecord(ReasonCode, z.enum(['hold', 'reject'])),
    }),
    audit: z.strictObject({ sampleRatePercent: z.number().int().min(0).max(100) }),
    funding: z.strictObject({ seedMinor: cents }),
    area: z.strictObject({
      name: z.string().min(1),
      polygon: z.strictObject({
        type: z.literal('Polygon'),
        coordinates: z.array(z.array(position).min(4)).min(1),
      }),
    }),
  })
  .refine(
    (p) => p.decisionPolicy.duplicateExactMaxDistance <= p.decisionPolicy.duplicateNearMaxDistance,
    'duplicateExactMaxDistance must not exceed duplicateNearMaxDistance',
  );

// Compile-time check that the schema produces the core Program type.
export const parseProgram = (input: unknown): Program => ProgramSchema.parse(input) as Program;
