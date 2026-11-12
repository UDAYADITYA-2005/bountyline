import {
  codesMatch,
  type CheckResult,
  type Program,
  type VisionFindings,
  type VisionResult,
} from '@bountyline/core';
import { declaredLengthCheck } from '../deterministic.js';

export interface MappingContext {
  program: Program;
  issuedCode: string;
  declaredLengthCm: number | null;
  /** Judge sample photo: no fresh code can be in it, and the board reading is not trusted. */
  samplePhoto: boolean;
  /** The scenario's photo shows its code card, so the code check runs for real. */
  sampleHasRealCode: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function speciesCheck(f: VisionFindings, program: Program): CheckResult {
  const min = program.decisionPolicy.speciesMinConfidence;
  const eligible = program.species.find((s) => s.key === f.species.key);
  const lookalike = program.lookalikes.find((l) => l.key === f.species.key);
  const label = `${f.species.commonName || f.species.key} (${pct(f.species.confidence)})`;
  if (eligible && f.species.confidence >= min)
    return { key: 'species', status: 'pass', confidence: f.species.confidence, detail: label };
  if ((lookalike || f.species.key === 'other') && f.species.confidence >= min) {
    return {
      key: 'species',
      status: 'fail',
      reason: 'wrong_species',
      confidence: f.species.confidence,
      detail: `${label}: not eligible`,
    };
  }
  return {
    key: 'species',
    status: 'uncertain',
    reason: 'species_uncertain',
    confidence: f.species.confidence,
    detail: `${label}: below the ${pct(min)} needed`,
  };
}

function lengthCheck(f: VisionFindings, ctx: MappingContext): CheckResult {
  const species = ctx.program.species[0];
  const minCm = species?.minLengthCm ?? null;
  if (ctx.samplePhoto) return declaredLengthCheck(ctx.declaredLengthCm, minCm);
  if (minCm === null) return { key: 'length', status: 'pass', detail: 'No minimum length' };
  const { cm, method, confidence } = f.length;
  if (
    method === 'board' &&
    cm !== null &&
    confidence >= ctx.program.decisionPolicy.lengthMinConfidence
  ) {
    return cm >= minCm
      ? {
          key: 'length',
          status: 'pass',
          confidence,
          detail: `${cm} cm on the board (minimum ${minCm} cm)`,
        }
      : {
          key: 'length',
          status: 'fail',
          reason: 'below_min_length',
          confidence,
          detail: `${cm} cm on the board; the minimum is ${minCm} cm`,
        };
  }
  if (ctx.program.evidence.measuringBoard === 'optional')
    return declaredLengthCheck(ctx.declaredLengthCm, minCm);
  return {
    key: 'length',
    status: 'uncertain',
    reason: 'length_uncertain',
    confidence,
    detail: 'Could not read the length from a measuring board',
  };
}

function codeCheck(f: VisionFindings, ctx: MappingContext): CheckResult {
  if (ctx.samplePhoto && !ctx.sampleHasRealCode) {
    return { key: 'code_in_frame', status: 'skipped', detail: 'skipped (sample photo)' };
  }
  const required = ctx.program.evidence.codeInFrame === 'required';
  if (f.code.visible && f.code.text) {
    // The model only reads the text; the comparison with the issued code happens here, in code.
    return codesMatch(f.code.text, ctx.issuedCode)
      ? {
          key: 'code_in_frame',
          status: 'pass',
          confidence: f.code.confidence,
          detail: `Read ${f.code.text}, matches the issued code`,
        }
      : {
          key: 'code_in_frame',
          status: 'uncertain',
          reason: 'code_mismatch',
          confidence: f.code.confidence,
          detail: `Read ${f.code.text}, which is not the issued code`,
        };
  }
  return required
    ? {
        key: 'code_in_frame',
        status: 'uncertain',
        reason: 'code_missing',
        confidence: f.code.confidence,
        detail: 'No code card visible',
      }
    : { key: 'code_in_frame', status: 'pass', detail: 'Code card not required' };
}

/** Turns findings into the five vision checks, exactly as the table in docs/AI_CHECKS.md. */
export function mapFindings(f: VisionFindings, ctx: MappingContext): CheckResult[] {
  const screenMin = ctx.program.decisionPolicy.screenSuspectedMinConfidence;
  return [
    speciesCheck(f, ctx.program),
    lengthCheck(f, ctx),
    codeCheck(f, ctx),
    f.quality.usable
      ? { key: 'photo_quality', status: 'pass', detail: 'Usable photo' }
      : {
          key: 'photo_quality',
          status: 'uncertain',
          reason: 'photo_unusable',
          detail: `Not usable: ${f.quality.issues.join(', ') || 'unclear'}`,
        },
    f.screenOrPrint.suspected && f.screenOrPrint.confidence >= screenMin
      ? {
          key: 'screen_suspected',
          status: 'fail',
          reason: 'screen_suspected',
          confidence: f.screenOrPrint.confidence,
          detail: f.screenOrPrint.why ?? 'Looks like a screen or a print',
        }
      : {
          key: 'screen_suspected',
          status: 'pass',
          confidence: f.screenOrPrint.confidence,
          detail: 'No sign of a screen or print',
        },
  ];
}

/** Vision checks for any provider result, including unavailable and invalid output. */
export function visionChecks(result: VisionResult, ctx: MappingContext): CheckResult[] {
  if (result.status === 'ok') {
    return mapFindings(result.findings, ctx).map((c) => ({
      ...c,
      evidence: {
        ...c.evidence,
        model: result.model,
        cached: result.cached,
        notes: result.findings.notes,
      },
    }));
  }
  const status = result.status === 'unavailable' ? 'unavailable' : 'uncertain';
  const detail =
    result.status === 'unavailable'
      ? `Photo check unavailable: ${result.reason}`
      : `Photo check gave unusable output: ${result.reason}`;
  const base = (key: CheckResult['key']): CheckResult =>
    status === 'unavailable'
      ? { key, status, detail }
      : { key, status, reason: 'check_error', detail };
  const samplePhotoCode: CheckResult | null =
    ctx.samplePhoto && !ctx.sampleHasRealCode
      ? { key: 'code_in_frame', status: 'skipped', detail: 'skipped (sample photo)' }
      : null;
  const length = ctx.samplePhoto
    ? declaredLengthCheck(ctx.declaredLengthCm, ctx.program.species[0]?.minLengthCm ?? null)
    : base('length');
  return [
    base('species'),
    length,
    samplePhotoCode ?? base('code_in_frame'),
    base('photo_quality'),
    base('screen_suspected'),
  ];
}
