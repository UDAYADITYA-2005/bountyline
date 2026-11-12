/** Observations returned by the vision model. Data only: never a decision. */
export interface VisionFindings {
  species: { key: string; commonName: string; confidence: number };
  length: { cm: number | null; method: 'board' | 'estimate' | 'none'; confidence: number };
  code: { visible: boolean; text: string | null; confidence: number };
  tag: { visible: boolean; text: string | null };
  quality: {
    usable: boolean;
    issues: ('blurry' | 'dark' | 'cropped' | 'obstructed' | 'no_animal')[];
  };
  screenOrPrint: { suspected: boolean; confidence: number; why: string | null };
  notes: string;
}

export interface VisionSpeciesHint {
  key: string;
  commonName: string;
  scientificName?: string | undefined;
  traits: string;
}

export interface VisionInput {
  jpeg: Uint8Array;
  sha256: string;
  eligible: VisionSpeciesHint[];
  lookalikes: VisionSpeciesHint[];
}

export type VisionResult =
  | { status: 'ok'; findings: VisionFindings; model: string; cached: boolean }
  | { status: 'unavailable'; reason: string }
  | { status: 'invalid'; reason: string };

/** Analyses a photo. Implemented by the Gemini provider in packages/checks. */
export interface VisionProvider {
  analyze(input: VisionInput): Promise<VisionResult>;
}
