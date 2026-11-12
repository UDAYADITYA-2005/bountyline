import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rewardFor } from '@bountyline/core';
import { describe, expect, it } from 'vitest';
import { envReport, parseEnv } from './env.js';
import { loadPrograms, loadScenarioPack, parseProgramYaml, repoPaths } from './loaders.js';

const paths = repoPaths();

describe('env', () => {
  it('requires PAYPAL_ENV to be exactly sandbox', () => {
    expect(() => parseEnv({})).toThrow(/PAYPAL_ENV/);
    expect(() => parseEnv({ PAYPAL_ENV: 'live' })).toThrow(/sandbox/);
    expect(() => parseEnv({ PAYPAL_ENV: 'production' })).toThrow(/sandbox/);
  });

  it('always uses the sandbox base URL', () => {
    const env = parseEnv({ PAYPAL_ENV: 'sandbox' });
    expect(env.paypalBaseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(env.JUDGE_MODE).toBe(false);
    expect(env.CHECK_RUNNER).toBe('inline');
  });

  it('parses flags and treats empty strings as unset', () => {
    const env = parseEnv({ PAYPAL_ENV: 'sandbox', JUDGE_MODE: 'true', GEMINI_API_KEY: '' });
    expect(env.JUDGE_MODE).toBe(true);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('needs a long session secret in production', () => {
    expect(() => parseEnv({ PAYPAL_ENV: 'sandbox', NODE_ENV: 'production' })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('reports set or missing without values', () => {
    const report = envReport({ PAYPAL_ENV: 'sandbox', GEMINI_API_KEY: 'secret-value' });
    expect(report.find((r) => r.name === 'GEMINI_API_KEY')).toEqual({
      name: 'GEMINI_API_KEY',
      set: true,
    });
    expect(JSON.stringify(report)).not.toContain('secret-value');
  });
});

describe('programs', () => {
  const programs = loadPrograms(paths.programsDir);

  it('loads both demo programs and skips the template', () => {
    expect(programs.map((p) => p.id)).toEqual(['columbia-pikeminnow', 'lake-roosevelt-pike']);
  });

  it('reads the tiers and the flat pike rate', () => {
    const [pikeminnow, pike] = programs;
    expect(pikeminnow && rewardFor(pikeminnow, 26).amountMinor).toBe(800);
    expect(pike && rewardFor(pike, 3).amountMinor).toBe(1000);
    expect(pike?.eligibility.minAge).toBe(17);
  });

  it('loads the template when parsed directly', () => {
    const text = readFileSync(path.join(paths.programsDir, 'own-photos.template.yaml'), 'utf8');
    expect(parseProgramYaml(text).id).toBe('own-photos');
  });

  it('fails a broken copy with a readable error', () => {
    const text = readFileSync(path.join(paths.programsDir, 'columbia-pikeminnow.yaml'), 'utf8')
      .replace('codeTtlMinutes: 15', 'codeTtlMinutes: soon')
      .replace('currency: USD', 'currency: EUR');
    expect(() => parseProgramYaml(text, 'broken.yaml')).toThrow(
      /Invalid file broken\.yaml:[\s\S]*currency[\s\S]*evidence\.codeTtlMinutes/,
    );
  });

  it('rejects unknown fields', () => {
    const text = readFileSync(path.join(paths.programsDir, 'lake-roosevelt-pike.yaml'), 'utf8');
    expect(() => parseProgramYaml(`${text}\nsurprise: true\n`)).toThrow(/surprise/);
  });
});

describe('scenario pack', () => {
  const programs = loadPrograms(paths.programsDir);
  it('loads seven scenarios and one seeded history claim', () => {
    const pack = loadScenarioPack(paths.scenariosFile, programs);
    expect(pack.scenarios).toHaveLength(7);
    expect(pack.seedHistory).toHaveLength(1);
    expect(pack.scenarios.find((s) => s.id === 'out-of-area')?.expect).toBe('hold');
  });

  it('rejects a scenario for an unknown program', () => {
    expect(() => loadScenarioPack(paths.scenariosFile, programs.slice(1))).toThrow(
      /unknown programId/,
    );
  });
});
