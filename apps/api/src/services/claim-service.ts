import {
  FINAL_CLAIM_STATUSES,
  type ClaimView,
  type EvidenceMeta,
  type MyClaimsResponse,
  type StartClaimBody,
} from '@bountyline/contracts';
import {
  DomainError,
  add,
  generateCode,
  money,
  nextTierAt,
  rewardFor,
  zonedStartOfDay,
  ZERO_USD,
  type Program,
} from '@bountyline/core';
import { ingestPhoto } from '@bountyline/checks';
import {
  claimantOwnsPhoto,
  countSeasonApproved,
  getClaim,
  getPayoutJob,
  insertClaim,
  insertPhoto,
  listChecks,
  listClaims,
  transitionClaim,
  type ClaimRecord,
  type UserRecord,
} from '@bountyline/db';
import type { AppDeps } from '../deps.js';
import { claimView, moneyView } from '../views.js';

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export class ClaimService {
  private readonly idempotency = new Map<string, { claimId: string; at: number }>();

  constructor(private readonly deps: AppDeps) {}

  program(id: string): { program: Program; version: number } {
    const entry = this.deps.programs.get(id);
    if (!entry) throw new DomainError('PROGRAM_NOT_FOUND', `No program ${id}.`);
    return entry;
  }

  ownsPhoto(userId: string, photoId: string): Promise<boolean> {
    return claimantOwnsPhoto(this.deps.db.db, userId, photoId);
  }

  async view(claim: ClaimRecord, exactLocation: boolean): Promise<ClaimView> {
    const db = this.deps.db.db;
    const [checks, job] = await Promise.all([listChecks(db, claim.id), getPayoutJob(db, claim.id)]);
    const programName = this.deps.programs.get(claim.programId)?.program.name ?? claim.programId;
    return claimView({ claim, programName, checks, job, exactLocation });
  }

  /** Loads a claim the user may see: its owner or any manager. Others get a 404, not a 403. */
  async getVisible(user: UserRecord, claimId: string): Promise<ClaimRecord> {
    const claim = await getClaim(this.deps.db.db, claimId);
    if (!claim || (user.role !== 'manager' && claim.claimantId !== user.id)) {
      throw new DomainError('CLAIM_NOT_FOUND', 'No such claim.');
    }
    return claim;
  }

  async start(
    user: UserRecord,
    body: StartClaimBody,
    opts: {
      idempotencyKey?: string | undefined;
      judge?: { sessionId: string; scenarioId: string; code?: string | undefined };
    } = {},
  ): Promise<ClaimRecord> {
    const { program, version } = this.program(body.programId);
    const now = this.deps.clock.now();
    const idemKey = opts.idempotencyKey ? `${user.id}:${opts.idempotencyKey}` : null;
    if (idemKey) {
      const hit = this.idempotency.get(idemKey);
      if (hit && now.getTime() - hit.at < IDEMPOTENCY_TTL_MS) {
        const existing = await getClaim(this.deps.db.db, hit.claimId);
        if (existing) return existing;
      }
    }
    if (program.eligibility.minAge !== null && !user.ageAttestedAt) {
      throw new DomainError(
        'NOT_ELIGIBLE',
        `This program is for claimants aged ${program.eligibility.minAge} or older.`,
      );
    }
    const speciesKey = body.speciesKey ?? program.species[0]?.key;
    if (!speciesKey || !program.species.some((s) => s.key === speciesKey)) {
      throw new DomainError('VALIDATION_FAILED', 'That species is not eligible for this program.');
    }
    const claim = await insertClaim(
      this.deps.db.db,
      {
        id: this.deps.ids.next(),
        programId: program.id,
        programVersion: version,
        claimantId: user.id,
        status: 'code_issued',
        code: opts.judge?.code ?? generateCode(this.deps.random),
        codeExpiresAt: new Date(now.getTime() + program.evidence.codeTtlMinutes * 60_000),
        speciesKey,
        source: opts.judge ? 'judge_scenario' : 'app',
        scenarioId: opts.judge?.scenarioId ?? null,
        judgeSessionId: opts.judge?.sessionId ?? user.judgeSessionId ?? null,
        createdAt: now,
        updatedAt: now,
      },
      { type: opts.judge ? 'judge' : 'system', id: opts.judge ? user.id : null },
    );
    if (idemKey) this.idempotency.set(idemKey, { claimId: claim.id, at: now.getTime() });
    return claim;
  }

  /** Stores the normalised photo and the capture facts, moves the claim to `checking`, starts checks. */
  async submitEvidence(
    user: UserRecord,
    claimId: string,
    photoBytes: Uint8Array,
    meta: EvidenceMeta,
    opts: { sample?: boolean; submittedAt?: Date | undefined } = {},
  ): Promise<ClaimRecord> {
    const claim = await this.getVisible(user, claimId);
    if (claim.claimantId !== user.id) throw new DomainError('CLAIM_NOT_FOUND', 'No such claim.');
    if (claim.status !== 'code_issued')
      throw new DomainError('INVALID_STATE', `Evidence was already sent for this claim.`);
    const photo = await ingestPhoto(photoBytes);
    const now = this.deps.clock.now();
    const db = this.deps.db.db;
    const updated = await db.transaction(async (tx) => {
      const stored = await insertPhoto(tx, {
        id: this.deps.ids.next(),
        sha256: photo.sha256,
        phash: photo.phash,
        dhash: photo.dhash,
        mime: 'image/jpeg',
        width: photo.width,
        height: photo.height,
        bytes: photo.jpeg,
        sample: opts.sample ?? false,
        createdAt: now,
      });
      return transitionClaim(tx, {
        claimId,
        event: 'evidence',
        now,
        actor: { type: claim.source === 'judge_scenario' ? 'judge' : 'system', id: user.id },
        action: 'evidence_submitted',
        data: { photoSha256: photo.sha256, sample: opts.sample ?? false },
        patch: {
          photoId: stored.id,
          lat: meta.lat,
          lng: meta.lng,
          locationAccuracyM: Math.round(meta.accuracyM),
          capturedAt: new Date(meta.capturedAt),
          submittedAt: opts.submittedAt ?? now,
          declaredLengthCm: meta.declaredLengthCm ?? null,
        },
      });
    });
    await this.deps.checkRunner.start(claimId);
    return updated;
  }

  async listMine(
    user: UserRecord,
    q: { cursor?: string | undefined; limit: number },
  ): Promise<MyClaimsResponse> {
    const db = this.deps.db.db;
    const claims = await listClaims(db, { claimantId: user.id, cursor: q.cursor, limit: q.limit });
    const all = await listClaims(db, { claimantId: user.id, limit: 1000 });
    let paid = ZERO_USD;
    let pending = ZERO_USD;
    for (const c of all) {
      if (c.amountMinor === null) continue;
      if (c.status === 'paid') paid = add(paid, money(c.amountMinor));
      else if (!FINAL_CLAIM_STATUSES.includes(c.status))
        pending = add(pending, money(c.amountMinor));
    }
    const tierProgress = await Promise.all(
      [...this.deps.programs.values()].map(async ({ program }) => {
        const seasonCount = await countSeasonApproved(db, {
          claimantId: user.id,
          programId: program.id,
          seasonStartUtc: zonedStartOfDay(program.season.start, program.season.timezone),
          excludeClaimId: '',
        });
        return {
          programId: program.id,
          seasonCount,
          currentAmount: moneyView(rewardFor(program, seasonCount + 1)),
          nextTierAt: nextTierAt(program, seasonCount + 1),
        };
      }),
    );
    const views = await Promise.all(claims.map((c) => this.view(c, false)));
    const last = claims.at(-1);
    return {
      claims: views,
      ...(claims.length === q.limit && last ? { nextCursor: last.id } : {}),
      totals: {
        paid: moneyView(paid),
        pending: moneyView(pending),
        seasonCount: tierProgress.reduce((n, t) => n + t.seasonCount, 0),
        tierProgress,
      },
    };
  }
}
