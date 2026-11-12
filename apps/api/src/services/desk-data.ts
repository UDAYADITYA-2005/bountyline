import type { DeskTable } from '@bountyline/contracts';
import { listAllClaims, listLedger, listPayoutJobs, listUserNames, type Db } from '@bountyline/db';
import type { ProgramEntry } from '@bountyline/checks';

type Row = Record<string, string | number | boolean | null>;

// amountUsd is a display number for AG Studio charts only; money logic never reads it.
const usd = (minor: number | null): number | null => (minor === null ? null : minor / 100);

/** Flat, typed rows for AG Studio data sources. */
export async function deskRows(
  db: Db,
  programs: ReadonlyMap<string, ProgramEntry>,
  table: DeskTable,
): Promise<Row[]> {
  const programName = (id: string) => programs.get(id)?.program.name ?? id;
  const speciesName = (programId: string, key: string | null) =>
    programs.get(programId)?.program.species.find((s) => s.key === key)?.commonName ?? key;

  if (table === 'claims' || table === 'audits') {
    const claims = await listAllClaims(db);
    const names = await listUserNames(db, [...new Set(claims.map((c) => c.claimantId))]);
    if (table === 'audits') {
      return claims
        .filter((c) => c.status === 'paid')
        .map((c) => ({
          claimId: c.id,
          program: programName(c.programId),
          claimant: names.get(c.claimantId) ?? 'unknown',
          audit: c.auditStatus,
          amountUsd: usd(c.amountMinor),
          paidAt: c.updatedAt.toISOString(),
        }));
    }
    return claims.map((c) => ({
      id: c.id,
      program: programName(c.programId),
      programId: c.programId,
      claimant: names.get(c.claimantId) ?? 'unknown',
      species: speciesName(c.programId, c.speciesKey),
      lengthCm: c.declaredLengthCm,
      status: c.status,
      decision: c.decision,
      amountUsd: usd(c.amountMinor),
      submittedAt: c.submittedAt?.toISOString() ?? null,
      decidedAt: c.decidedAt?.toISOString() ?? null,
      lat: c.lat,
      lng: c.lng,
      holdReasons: c.reasons.map((r) => r.code).join(', '),
      audit: c.auditStatus,
      source: c.source,
      photoUrl: c.photoId ? `/api/v1/photos/${c.photoId}` : null,
    }));
  }

  if (table === 'payouts') {
    const [jobs, claims] = await Promise.all([listPayoutJobs(db), listAllClaims(db)]);
    const programOf = new Map(claims.map((c) => [c.id, c.programId]));
    return jobs.map((j) => ({
      claimId: j.claimId,
      program: programName(programOf.get(j.claimId) ?? ''),
      status: j.status,
      attempt: j.attempt,
      tries: j.tries,
      amountUsd: usd(j.amountMinor),
      paypalBatchId: j.paypalBatchId,
      paypalItemId: j.paypalItemId,
      lastError: j.lastError,
      updatedAt: j.updatedAt.toISOString(),
    }));
  }

  const ledger = await listLedger(db);
  return ledger.map((l) => ({
    id: l.id,
    program: programName(l.programId),
    kind: l.kind,
    amountUsd: usd(l.amountMinor),
    signedAmountUsd: usd(l.kind === 'reserve' ? -l.amountMinor : l.amountMinor),
    claimId: l.claimId,
    source: l.source,
    createdAt: l.createdAt.toISOString(),
  }));
}
