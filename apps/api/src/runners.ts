import { runClaimChecks, type CheckDeps } from '@bountyline/checks';
import { Render } from '@renderinc/sdk';
import { appendLog, SYSTEM } from '@bountyline/db';
import type { FastifyBaseLogger } from 'fastify';
import type { CheckRunner } from './deps.js';

/** Runs checks in the API process (local, tests, and the fallback). */
export class InlineCheckRunner implements CheckRunner {
  readonly name = 'inline' as const;
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly deps: CheckDeps,
    private readonly log: FastifyBaseLogger,
    private readonly awaitRuns = false,
  ) {}

  async start(claimId: string): Promise<void> {
    const run = runClaimChecks(this.deps, claimId)
      .then((r) =>
        this.log.info(
          {
            claimId,
            runner: 'inline',
            status: r.status,
            outcome: 'outcome' in r ? r.outcome : undefined,
            latencyMs: r.elapsedMs,
          },
          'claim checks finished',
        ),
      )
      .catch((err: unknown) => this.log.error({ claimId, err }, 'claim checks crashed'));
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
    if (this.awaitRuns) await run;
  }

  /** Waits for in-flight runs (tests and graceful shutdown). */
  async drain(): Promise<void> {
    await Promise.all([...this.running]);
  }
}

/** Starts the Render Workflows task; falls back to inline if Render refuses (ADR 0005). */
export class RenderWorkflowsCheckRunner implements CheckRunner {
  readonly name = 'render' as const;
  private readonly render: Render;

  constructor(
    apiKey: string,
    private readonly taskSlug: string,
    private readonly fallback: InlineCheckRunner,
    private readonly deps: CheckDeps,
    private readonly log: FastifyBaseLogger,
  ) {
    this.render = new Render({ token: apiKey });
  }

  async start(claimId: string): Promise<void> {
    try {
      const run = await this.render.workflows.startTask(this.taskSlug, [claimId], {
        idempotencyKey: `checks-${claimId}`,
      });
      await appendLog(this.deps.db, {
        at: this.deps.clock.now(),
        claimId,
        actor: SYSTEM,
        action: 'checks_started',
        data: { runner: 'render', taskRunId: run.taskRunId },
      });
      this.log.info({ claimId, taskRunId: run.taskRunId }, 'workflow task started');
    } catch (err) {
      this.log.warn(
        { claimId, err: (err as Error).name },
        'Render Workflows refused the start; running checks inline',
      );
      await this.fallback.start(claimId);
    }
  }
}
