import type {
  AgDefaultWidgetDefinition,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
} from 'ag-studio';
import type { AgRegistry, AgWidgetDefinition } from 'ag-studio-react';

export type EvidenceWidgetState = AgWidgetData<
  { claimId: AgWidgetFieldReference[] },
  AgWidgetDataFormat<unknown>
> & {
  type: 'bountyline-evidence';
};
export type QueueWidgetState = AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>> & {
  type: 'bountyline-review-queue';
};

export type EvidenceWidgetDef = AgWidgetDefinition<'bountyline-evidence', EvidenceWidgetState>;
export type QueueWidgetDef = AgWidgetDefinition<'bountyline-review-queue', QueueWidgetState>;

/** Studio registry with the two Bountyline custom widgets added to the defaults. */
export interface DeskRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | EvidenceWidgetDef | QueueWidgetDef)[];
}
