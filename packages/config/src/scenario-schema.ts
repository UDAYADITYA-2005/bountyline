import { z } from 'zod';

const location = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative(),
});

const declared = z.strictObject({
  speciesKey: z.string().min(1),
  lengthCm: z.number().positive().optional(),
});

const photo = z.string().regex(/^[\w.-]+\.jpe?g$/i, 'photo must be a .jpg file name');

export const ScenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  story: z.string().min(1),
  programId: z.string().min(1),
  photo,
  declared,
  location,
  expect: z.enum(['approve', 'hold', 'reject']),
  code: z
    .string()
    .regex(/^[A-Z2-9]{2}-[A-Z2-9]{2}$/)
    .optional(),
  submittedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const SeedHistorySchema = z.strictObject({
  programId: z.string().min(1),
  photo,
  declared,
  location,
  daysAgo: z.number().int().nonnegative(),
});
export type SeedHistory = z.infer<typeof SeedHistorySchema>;

export const ScenarioPackSchema = z
  .strictObject({
    version: z.literal(1),
    seedHistory: z.array(SeedHistorySchema),
    scenarios: z.array(ScenarioSchema).min(1),
  })
  .refine(
    (p) => new Set(p.scenarios.map((s) => s.id)).size === p.scenarios.length,
    'scenario ids must be unique',
  );
export type ScenarioPack = z.infer<typeof ScenarioPackSchema>;
