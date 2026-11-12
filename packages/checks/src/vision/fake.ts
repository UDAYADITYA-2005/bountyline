import type { VisionFindings, VisionInput, VisionProvider, VisionResult } from '@bountyline/core';

/** Test double: returns recorded findings by photo SHA-256, or `unavailable` when unknown. */
export class FakeVisionProvider implements VisionProvider {
  readonly calls: VisionInput[] = [];
  constructor(
    private readonly bySha: Map<string, VisionFindings | 'unavailable' | 'invalid'> = new Map(),
    private readonly fallback: VisionFindings | 'unavailable' = 'unavailable',
  ) {}

  set(sha256: string, findings: VisionFindings | 'unavailable' | 'invalid'): void {
    this.bySha.set(sha256, findings);
  }

  async analyze(input: VisionInput): Promise<VisionResult> {
    this.calls.push(input);
    const hit = this.bySha.get(input.sha256) ?? this.fallback;
    if (hit === 'unavailable') return { status: 'unavailable', reason: 'fake: unavailable' };
    if (hit === 'invalid') return { status: 'invalid', reason: 'fake: invalid' };
    return { status: 'ok', findings: hit, model: 'fake', cached: false };
  }
}

/** Findings for a clean, eligible fish on a board; override fields per scenario. */
export function cleanFindings(overrides: Partial<VisionFindings> = {}): VisionFindings {
  return {
    species: { key: 'northern_pikeminnow', commonName: 'Northern pikeminnow', confidence: 0.92 },
    length: { cm: 34, method: 'board', confidence: 0.8 },
    code: { visible: false, text: null, confidence: 0.1 },
    tag: { visible: false, text: null },
    quality: { usable: true, issues: [] },
    screenOrPrint: { suspected: false, confidence: 0.05, why: null },
    notes: 'One whole fish, side view.',
    ...overrides,
  };
}
