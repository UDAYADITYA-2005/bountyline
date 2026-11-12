import { defineConfig } from 'tsup';

// Bundles @bountyline/* source packages into dist; third-party packages stay external.
export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/migrate.ts', seed: 'src/seed-cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@bountyline\//],
  splitting: false,
});
