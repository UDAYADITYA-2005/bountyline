import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from './deps.js';
import { AuthService } from './services/auth-service.js';
import { ClaimService } from './services/claim-service.js';
import { DeskService } from './services/desk-service.js';
import { JudgeService } from './services/judge-service.js';
import { PayoutService } from './services/payout-service.js';

export interface Services {
  deps: AppDeps;
  auth: AuthService;
  claims: ClaimService;
  desk: DeskService;
  judge: JudgeService;
  payouts: PayoutService;
}

export function createServices(deps: AppDeps, log: FastifyBaseLogger): Services {
  const auth = new AuthService(deps);
  const claims = new ClaimService(deps);
  return {
    deps,
    auth,
    claims,
    desk: new DeskService(deps),
    judge: new JudgeService(deps, auth, claims),
    payouts: new PayoutService(deps, log),
  };
}
