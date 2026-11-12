import { loadEnv } from '@bountyline/config';
import pino from 'pino';
import { LOG_REDACT, buildApp } from './app.js';
import { startLoops } from './jobs.js';
import { createProductionDeps } from './production.js';
import { InlineCheckRunner } from './runners.js';

const config = loadEnv();
const bootLog = pino({ level: config.LOG_LEVEL, redact: LOG_REDACT });
const deps = await createProductionDeps(config, bootLog);
const { app, services } = await buildApp(deps);
const loops = startLoops(deps, services.payouts, app.log);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await loops.stop();
  await app.close();
  if (deps.checkRunner instanceof InlineCheckRunner) await deps.checkRunner.drain();
  await deps.db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.PORT });
app.log.info(
  { runner: deps.checkRunner.name, judgeMode: config.JUDGE_MODE, version: deps.version },
  'bountyline api ready',
);
