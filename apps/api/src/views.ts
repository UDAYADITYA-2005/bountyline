import { ALL_CHECK_KEYS_VIEW } from './view-constants.js';
import {
  CHECK_LABELS,
  type CheckView,
  type ClaimView,
  type MoneyView,
  type ProgramSummary,
  type UserView,
} from '@bountyline/contracts';
import { formatUsd, money, type Money, type Program } from '@bountyline/core';
import type { CheckRecord, ClaimRecord, PayoutJobRecord, UserRecord } from '@bountyline/db';
import { maskEmail } from '@bountyline/paypal';

export function moneyView(m: Money): MoneyView {
  return { amountMinor: m.amountMinor, currency: 'USD', formatted: formatUsd(m) };
}

export function userView(u: UserRecord): UserView {
  return {
    id: u.id,
    email: u.judgeSessionId ? u.email : maskEmail(u.email),
    role: u.role,
    displayName: u.displayName,
    paypalEmailMasked: u.paypalEmail ? maskEmail(u.paypalEmail) : null,
    judge: u.judgeSessionId !== null,
  };
}

function checkView(key: CheckView['key'], rec: CheckRecord | undefined): CheckView {
  if (!rec) return { key, status: 'pending', label: CHECK_LABELS[key], detail: 'Waiting' };
  return {
    key,
    status: rec.status,
    ...(rec.confidence !== null ? { confidence: Math.min(1, Math.max(0, rec.confidence)) } : {}),
    label: CHECK_LABELS[key],
    detail: rec.detail,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Builds the API's ClaimView. Exact location is for the desk; everyone else sees 3 decimals. */
export function claimView(input: {
  claim: ClaimRecord;
  programName: string;
  checks: CheckRecord[];
  job: PayoutJobRecord | null;
  exactLocation: boolean;
}): ClaimView {
  const { claim, checks, job } = input;
  const byKey = new Map(checks.map((c) => [c.checkKey, c]));
  const showChecks = claim.status !== 'code_issued' && claim.status !== 'expired';
  const loc =
    claim.lat !== null && claim.lng !== null
      ? {
          lat: input.exactLocation ? claim.lat : round3(claim.lat),
          lng: input.exactLocation ? claim.lng : round3(claim.lng),
          accuracyM: claim.locationAccuracyM ?? 0,
        }
      : undefined;
  return {
    id: claim.id,
    programId: claim.programId,
    programName: input.programName,
    status: claim.status,
    code: claim.code,
    codeExpiresAt: claim.codeExpiresAt.toISOString(),
    ...(claim.speciesKey ? { speciesKey: claim.speciesKey } : {}),
    ...(claim.declaredLengthCm !== null ? { declaredLengthCm: claim.declaredLengthCm } : {}),
    ...(claim.photoId ? { photoUrl: `/api/v1/photos/${claim.photoId}` } : {}),
    ...(loc ? { location: loc } : {}),
    checks: showChecks ? ALL_CHECK_KEYS_VIEW.map((k) => checkView(k, byKey.get(k))) : [],
    ...(claim.decision ? { decision: claim.decision } : {}),
    reasons: claim.reasons.map((r) => ({
      code: r.code,
      message: r.message,
      ...(r.checkKey ? { checkKey: r.checkKey } : {}),
    })),
    ...(claim.amountMinor !== null ? { amount: moneyView(money(claim.amountMinor)) } : {}),
    ...(job
      ? {
          payout: {
            status: job.status,
            ...(job.paypalItemId ? { paypalItemId: job.paypalItemId } : {}),
            updatedAt: job.updatedAt.toISOString(),
          },
        }
      : {}),
    audit: claim.auditStatus,
    source: claim.source,
    ...(claim.scenarioId ? { scenarioId: claim.scenarioId } : {}),
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
  };
}

export function programSummary(p: Program): ProgramSummary {
  const tiers =
    p.rewards.scheme === 'flat'
      ? [{ fromCount: 1, amount: moneyView(money(p.rewards.amountMinor)) }]
      : [...p.rewards.tiers]
          .sort((a, b) => a.fromCount - b.fromCount)
          .map((t) => ({ fromCount: t.fromCount, amount: moneyView(money(t.amountMinor)) }));
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    modeledOn: p.modeledOn,
    species: p.species.map((s) => ({
      key: s.key,
      commonName: s.commonName,
      scientificName: s.scientificName,
      minLengthCm: s.minLengthCm,
    })),
    rewards: { scheme: p.rewards.scheme, tiers },
    season: p.season,
    areaName: p.area.name,
    minAge: p.eligibility.minAge,
    codeTtlMinutes: p.evidence.codeTtlMinutes,
    measuringBoard: p.evidence.measuringBoard,
  };
}
