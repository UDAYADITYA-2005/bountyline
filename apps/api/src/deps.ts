import type { ScenarioPack, AppConfig } from '@bountyline/config';
import type { Clock, IdGenerator, PayoutGateway, Random, VisionProvider } from '@bountyline/core';
import type { ProgramEntry } from '@bountyline/checks';
import type { DbHandle } from '@bountyline/db';

/** Starts checks for a claim that just moved to `checking`. */
export interface CheckRunner {
  readonly name: 'inline' | 'render';
  start(claimId: string): Promise<void>;
}

/** Every outside dependency of the app, so tests pass fakes (backend rules). */
export interface AppDeps {
  config: AppConfig;
  db: DbHandle;
  programs: ReadonlyMap<string, ProgramEntry>;
  scenarios: ScenarioPack | null;
  photosDir: string;
  payoutGateway: PayoutGateway | null;
  vision: VisionProvider;
  checkRunner: CheckRunner;
  clock: Clock;
  random: Random;
  ids: IdGenerator;
  /** Fetches a PayPal cert PEM for webhook verification. */
  getCert: (url: string) => Promise<string>;
  webDist: string | null;
  version: string;
  /** Tests switch rate limits off except where they test them. */
  rateLimits?: boolean;
  logger?: boolean;
}
