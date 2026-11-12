import { ESLint } from 'eslint';
import { findRepoRoot } from '@bountyline/config';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The dependency rule is enforced by lint, not only by convention.
const root = findRepoRoot();
const eslint = new ESLint({ cwd: root });

async function ruleIds(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('dependency rule', () => {
  it('fails lint when packages/checks imports @bountyline/paypal', async () => {
    const ids = await ruleIds(
      'packages/checks/src/forbidden.ts',
      "import { createPayPalClient } from '@bountyline/paypal';\nexport const x = createPayPalClient;\n",
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('fails lint when apps/web imports anything but contracts', async () => {
    const ids = await ruleIds(
      'apps/web/src/forbidden.ts',
      "import { decide } from '@bountyline/core';\nexport const x = decide;\n",
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('fails lint when packages/core imports a Node module', async () => {
    const ids = await ruleIds(
      'packages/core/src/forbidden.ts',
      "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('allows the api to import paypal', async () => {
    const ids = await ruleIds(
      'apps/api/src/allowed.ts',
      "import { createPayPalClient } from '@bountyline/paypal';\nexport const x = createPayPalClient;\n",
    );
    expect(ids).not.toContain('no-restricted-imports');
  });
});
