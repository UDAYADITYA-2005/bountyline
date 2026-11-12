import { isInSeason, localDate, type CheckResult, type Program } from '@bountyline/core';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';
import type { DuplicateCandidate } from '@bountyline/db';

// Deterministic checks: pure functions over facts the orchestrator loads. They never call a model.

/** Photo reuse by SHA-256 and pHash Hamming distance to the closest prior claim in scope. */
export function duplicateCheck(
  candidates: readonly DuplicateCandidate[],
  policy: Program['decisionPolicy'],
): CheckResult {
  const closest = [...candidates].sort((a, b) => a.distance - b.distance)[0];
  const exact = candidates.find((c) => c.sameSha);
  if (exact) {
    return {
      key: 'duplicate',
      status: 'fail',
      reason: 'duplicate_exact',
      detail: 'Same photo as an earlier claim',
      evidence: { claimId: exact.claimId, distance: 0 },
    };
  }
  if (!closest || closest.distance > policy.duplicateNearMaxDistance) {
    return {
      key: 'duplicate',
      status: 'pass',
      detail: closest
        ? `No similar photo (closest distance ${closest.distance})`
        : 'No earlier photos to compare',
      evidence: closest ? { distance: closest.distance } : undefined,
    };
  }
  if (closest.distance <= policy.duplicateExactMaxDistance) {
    return {
      key: 'duplicate',
      status: 'fail',
      reason: 'duplicate_exact',
      detail: `Matches an earlier claim (distance ${closest.distance})`,
      evidence: { claimId: closest.claimId, distance: closest.distance },
    };
  }
  return {
    key: 'duplicate',
    status: 'uncertain',
    reason: 'duplicate_near',
    detail: `Very similar to an earlier claim (distance ${closest.distance})`,
    evidence: { claimId: closest.claimId, distance: closest.distance },
  };
}

/** Geofence: point in the program polygon, with a location accuracy threshold. */
export function areaCheck(
  loc: { lat: number; lng: number; accuracyM: number } | null,
  program: Pick<Program, 'area' | 'evidence'>,
): CheckResult {
  if (!loc)
    return {
      key: 'area',
      status: 'uncertain',
      reason: 'low_location_accuracy',
      detail: 'No location was sent',
    };
  const inside = booleanPointInPolygon(
    point([loc.lng, loc.lat]),
    polygon(program.area.polygon.coordinates),
  );
  const where = `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`;
  if (!inside) {
    return {
      key: 'area',
      status: 'fail',
      reason: 'outside_area',
      detail: `${where} is outside ${program.area.name}`,
      evidence: { accuracyM: loc.accuracyM },
    };
  }
  if (loc.accuracyM > program.evidence.maxLocationAccuracyM) {
    return {
      key: 'area',
      status: 'uncertain',
      reason: 'low_location_accuracy',
      detail: `Location accurate to ${Math.round(loc.accuracyM)} m; the program needs ${program.evidence.maxLocationAccuracyM} m`,
      evidence: { accuracyM: loc.accuracyM },
    };
  }
  return {
    key: 'area',
    status: 'pass',
    detail: `Inside the program area (±${Math.round(loc.accuracyM)} m)`,
  };
}

/** Season: the server submit time in the program time zone. */
export function seasonCheck(submittedAt: Date, season: Program['season']): CheckResult {
  const day = localDate(submittedAt, season.timezone);
  return isInSeason(submittedAt, season)
    ? {
        key: 'season',
        status: 'pass',
        detail: `${day} is in season (${season.start} to ${season.end})`,
      }
    : {
        key: 'season',
        status: 'fail',
        reason: 'out_of_season',
        detail: `${day} is outside the season (${season.start} to ${season.end})`,
      };
}

/** Claim rate: submissions in the last 24 hours, counting this one. */
export function claimRateCheck(
  countInWindowIncludingThis: number,
  maxClaimsPerDay: number,
): CheckResult {
  return countInWindowIncludingThis <= maxClaimsPerDay
    ? {
        key: 'claim_rate',
        status: 'pass',
        detail: `${countInWindowIncludingThis} of ${maxClaimsPerDay} claims in 24 hours`,
      }
    : {
        key: 'claim_rate',
        status: 'fail',
        reason: 'claim_rate_exceeded',
        detail: `${countInWindowIncludingThis} claims in 24 hours; the limit is ${maxClaimsPerDay}`,
      };
}

/** Code expiry: the photo arrived before the one-time code expired. */
export function codeExpiryCheck(submittedAt: Date, codeExpiresAt: Date): CheckResult {
  return submittedAt.getTime() <= codeExpiresAt.getTime()
    ? { key: 'code_expiry', status: 'pass', detail: 'Submitted before the code expired' }
    : {
        key: 'code_expiry',
        status: 'fail',
        reason: 'code_expired',
        detail: 'Submitted after the code expired',
      };
}

/** Length from the declared value, used for Judge sample photos (no board reading to trust). */
export function declaredLengthCheck(
  declaredCm: number | null,
  minLengthCm: number | null,
): CheckResult {
  if (minLengthCm === null) return { key: 'length', status: 'pass', detail: 'No minimum length' };
  if (declaredCm === null)
    return {
      key: 'length',
      status: 'uncertain',
      reason: 'length_uncertain',
      detail: 'No length was declared',
    };
  return declaredCm >= minLengthCm
    ? {
        key: 'length',
        status: 'pass',
        detail: `${declaredCm} cm declared (minimum ${minLengthCm} cm, sample photo)`,
      }
    : {
        key: 'length',
        status: 'fail',
        reason: 'below_min_length',
        detail: `${declaredCm} cm declared; the minimum is ${minLengthCm} cm`,
      };
}
