import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Program } from '@bountyline/core';
import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import { ProgramSchema } from './program-schema.js';
import { ScenarioPackSchema, type ScenarioPack } from './scenario-schema.js';

export class ProgramFileError extends Error {
  constructor(file: string, detail: string) {
    super(`Invalid file ${file}:\n${detail}`);
    this.name = 'ProgramFileError';
  }
}

function describe(error: ZodError): string {
  return error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

/** Walks up from a directory until it finds pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml above ${start}`);
    dir = parent;
  }
}

/** Parses and validates one program from YAML text. */
export function parseProgramYaml(text: string, file = 'program.yaml'): Program {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ProgramFileError(file, `  YAML: ${(e as Error).message}`);
  }
  const parsed = ProgramSchema.safeParse(raw);
  if (!parsed.success) throw new ProgramFileError(file, describe(parsed.error));
  return parsed.data as Program;
}

/** Loads programs/*.yaml, skipping *.template.yaml. Throws on any invalid file. */
export function loadPrograms(dir: string): Program[] {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !/\.template\.ya?ml$/.test(f))
    .sort();
  const programs = files.map((f) => parseProgramYaml(readFileSync(path.join(dir, f), 'utf8'), f));
  const ids = new Set<string>();
  for (const p of programs) {
    if (ids.has(p.id)) throw new ProgramFileError(dir, `  duplicate program id ${p.id}`);
    ids.add(p.id);
  }
  return programs;
}

/** Parses and validates the scenario pack, checking program references. */
export function parseScenarioPack(
  text: string,
  programs: Program[],
  file = 'scenarios.yaml',
): ScenarioPack {
  const parsed = ScenarioPackSchema.safeParse(parseYaml(text));
  if (!parsed.success) throw new ProgramFileError(file, describe(parsed.error));
  const ids = new Set(programs.map((p) => p.id));
  const all = [...parsed.data.scenarios, ...parsed.data.seedHistory];
  for (const s of all) {
    if (!ids.has(s.programId)) {
      throw new ProgramFileError(file, `  unknown programId ${s.programId}`);
    }
  }
  return parsed.data;
}

/** Loads samples/scenarios.yaml. */
export function loadScenarioPack(file: string, programs: Program[]): ScenarioPack {
  return parseScenarioPack(readFileSync(file, 'utf8'), programs, path.basename(file));
}

export interface RepoPaths {
  root: string;
  programsDir: string;
  scenariosFile: string;
  photosDir: string;
  migrationsDir: string;
  webDist: string;
}

/** Well-known paths inside the repo, resolved from the workspace root. */
export function repoPaths(root: string = findRepoRoot()): RepoPaths {
  return {
    root,
    programsDir: path.join(root, 'programs'),
    scenariosFile: path.join(root, 'samples', 'scenarios.yaml'),
    photosDir: path.join(root, 'samples', 'photos'),
    migrationsDir: path.join(root, 'packages', 'db', 'migrations'),
    webDist: path.join(root, 'apps', 'web', 'dist'),
  };
}
