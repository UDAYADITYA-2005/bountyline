import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Scenario } from '@bountyline/config';
import type { ScenarioView } from '@bountyline/contracts';
import { DomainError } from '@bountyline/core';
import { createUser, findUserByEmail, type ClaimRecord, type UserRecord } from '@bountyline/db';
import type { AppDeps } from '../deps.js';
import type { AuthService } from './auth-service.js';
import type { ClaimService } from './claim-service.js';
import { newSessionId } from './auth-service.js';

const FALLBACK_RECEIVER = 'judge-receiver@example.com';

export class JudgeService {
  constructor(
    private readonly deps: AppDeps,
    private readonly auth: AuthService,
    private readonly claims: ClaimService,
  ) {}

  private assertOn(): void {
    if (!this.deps.config.JUDGE_MODE) throw new DomainError('JUDGE_MODE_OFF', 'Judge mode is off.');
  }

  scenario(id: string): Scenario {
    this.assertOn();
    const s = this.deps.scenarios?.scenarios.find((x) => x.id === id);
    if (!s) throw new DomainError('SCENARIO_NOT_FOUND', `No scenario ${id}.`);
    return s;
  }

  list(): ScenarioView[] {
    this.assertOn();
    return (this.deps.scenarios?.scenarios ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      story: s.story,
      programId: s.programId,
      expect: s.expect,
      photoUrl: `/api/v1/judge/scenarios/${s.id}/photo`,
      realCode: s.code !== undefined,
    }));
  }

  photoPath(id: string): string {
    const file = path.join(this.deps.photosDir, path.basename(this.scenario(id).photo));
    if (!existsSync(file))
      throw new DomainError(
        'PHOTO_NOT_FOUND',
        `Sample photo ${path.basename(file)} is missing from samples/photos.`,
      );
    return file;
  }

  /** A judge session: an ephemeral claimant paid to the sandbox personal account, or the demo manager. */
  async createSession(
    as: 'claimant' | 'manager',
  ): Promise<{ user: UserRecord; sessionId: string }> {
    this.assertOn();
    const { db, clock, ids, config } = this.deps;
    if (as === 'manager') {
      const manager = await findUserByEmail(db.db, config.DEMO_MANAGER_EMAIL);
      if (!manager || manager.role !== 'manager')
        throw new DomainError('NOT_FOUND', 'The demo manager is not seeded yet. Run pnpm seed.');
      return { user: manager, sessionId: await this.auth.startSession(manager.id) };
    }
    const judgeSessionId = newSessionId()
      .slice(0, 12)
      .replace(/[^A-Za-z0-9]/g, 'x');
    const now = clock.now();
    const user = await createUser(db.db, {
      id: ids.next(),
      email: `judge-${judgeSessionId.toLowerCase()}@bountyline.demo`,
      role: 'claimant',
      displayName: `Judge ${judgeSessionId.slice(0, 4)}`,
      passwordHash: null,
      paypalEmail: config.DEMO_CLAIMANT_PAYPAL_EMAIL ?? FALLBACK_RECEIVER,
      ageAttestedAt: now,
      judgeSessionId,
      createdAt: now,
    });
    return { user, sessionId: await this.auth.startSession(user.id) };
  }

  /** Runs a scenario as the judge claimant: real claim, sample photo, simulated location, real checks. */
  async run(user: UserRecord, scenarioId: string): Promise<ClaimRecord> {
    const s = this.scenario(scenarioId);
    if (!user.judgeSessionId)
      throw new DomainError('FORBIDDEN', 'Start a Judge claimant session first.');
    const bytes = readFileSync(this.photoPath(scenarioId));
    const claim = await this.claims.start(
      user,
      { programId: s.programId, speciesKey: s.declared.speciesKey },
      { judge: { sessionId: user.judgeSessionId, scenarioId, code: s.code } },
    );
    return this.claims.submitEvidence(
      user,
      claim.id,
      bytes,
      {
        lat: s.location.lat,
        lng: s.location.lng,
        accuracyM: s.location.accuracyM,
        capturedAt: this.deps.clock.now().toISOString(),
        ...(s.declared.lengthCm !== undefined ? { declaredLengthCm: s.declared.lengthCm } : {}),
      },
      // A photo with its own code card on it is treated as a real photo, so the code check runs.
      {
        sample: s.code === undefined,
        submittedAt: s.submittedAt ? new Date(s.submittedAt) : undefined,
      },
    );
  }
}
