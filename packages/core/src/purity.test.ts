import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// packages/core is pure: scan its source (not tests) for I/O and ambient state.
const root = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]node:/, 'node: import'],
  [/\bprocess\./, 'process'],
  [/Date\.now\s*\(/, 'Date.now()'],
  [/Math\.random\s*\(/, 'Math.random()'],
  [/new Date\(\s*\)/, 'new Date() without an argument'],
  [/from\s+['"]@bountyline\/(?!contracts['"])/, 'internal package other than contracts'],
  [/\bfetch\s*\(/, 'fetch'],
];

describe('packages/core purity', () => {
  const files = sourceFiles(root);
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  it.each(files.map((f) => [path.relative(root, f), f]))(
    '%s has no I/O or ambient state',
    (_n, f) => {
      const text = readFileSync(f, 'utf8');
      for (const [re, what] of FORBIDDEN) expect(text, what).not.toMatch(re);
    },
  );
});
