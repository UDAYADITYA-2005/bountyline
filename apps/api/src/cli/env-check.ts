import { processEnvReport } from '@bountyline/config';

// `pnpm env:check`: which variables are set. Never prints a value.
const rows = processEnvReport();
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows)
  process.stdout.write(`${r.name.padEnd(width)}  ${r.set ? 'set' : 'missing'}\n`);
