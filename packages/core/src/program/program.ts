import type { ReasonCode } from '@bountyline/contracts';

export interface SpeciesDef {
  key: string;
  commonName: string;
  scientificName: string;
  minLengthCm: number | null;
  traits: string;
}

export interface LookalikeDef {
  key: string;
  commonName: string;
  traits: string;
}

export interface Tier {
  fromCount: number;
  amountMinor: number;
}

export type RewardScheme =
  | { scheme: 'flat'; amountMinor: number }
  | {
      scheme: 'cumulative_tiers';
      window: 'season';
      tiers: Tier[];
      tagBonus?: { amountMinor: number; tagList: string[] } | undefined;
    };

export interface DecisionPolicy {
  speciesMinConfidence: number;
  lengthMinConfidence: number;
  screenSuspectedMinConfidence: number;
  duplicateExactMaxDistance: number;
  duplicateNearMaxDistance: number;
  overrides: Partial<Record<ReasonCode, 'hold' | 'reject'>>;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

/** A validated program file. Parsed from YAML by packages/config. */
export interface Program {
  id: string;
  name: string;
  summary: string;
  modeledOn: { name: string; url: string; note: string };
  currency: 'USD';
  species: SpeciesDef[];
  lookalikes: LookalikeDef[];
  evidence: {
    codeInFrame: 'required' | 'optional';
    measuringBoard: 'required' | 'optional';
    codeTtlMinutes: number;
    maxLocationAccuracyM: number;
  };
  rewards: RewardScheme;
  limits: { maxClaimsPerDay: number; maxPayoutMinorPerReceiverPerDay: number };
  season: { start: string; end: string; timezone: string };
  eligibility: { minAge: number | null };
  decisionPolicy: DecisionPolicy;
  audit: { sampleRatePercent: number };
  funding: { seedMinor: number };
  area: { name: string; polygon: GeoPolygon };
}
