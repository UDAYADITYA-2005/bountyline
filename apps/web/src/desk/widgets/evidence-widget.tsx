import type { AgWidgetParams } from 'ag-studio';
import { useEffect, useState } from 'react';
import { ClaimEvidence } from '../claim-evidence';
import { onSelectClaim } from '../desk-events';
import type { EvidenceWidgetDef, EvidenceWidgetState } from './widget-types';

/** Picks the claim ID when the cross filter narrows the claims to exactly one row. */
export function singleClaimId(rows: Record<string, unknown>[], keys: string[]): string | null {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'string' && v) {
        ids.add(v);
        break;
      }
    }
  }
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
}

/**
 * Follows the cross-filter selection: when a claim row is clicked in the grid, Studio filters
 * this widget's query to that claim and it shows the photo, checks and reasons. The review queue
 * can also select a claim directly.
 */
function EvidenceWidget(params: AgWidgetParams<EvidenceWidgetState>) {
  const field = params.dataMapping.claimId?.[0];
  const [fromFilter, setFromFilter] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => onSelectClaim(setPicked), []);
  useEffect(() => {
    if (!field) return;
    const ctrl = new AbortController();
    const keys = [field.key, String(field.fieldId), 'id'];
    const apply = (rows: Record<string, unknown>[]): void => {
      const id = singleClaimId(rows, keys);
      setFromFilter(id);
      if (id) setPicked(null);
    };
    params.widgetApi
      .getData(
        { fields: [field] },
        { signal: ctrl.signal, onDataUpdated: (r) => apply(r.results.rows) },
      )
      .then((r) => apply(r.results.rows))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [field, params.widgetApi]);

  const claimId = picked ?? fromFilter;
  return (
    <div className="h-full overflow-auto bg-surface text-ink">
      {field ? null : (
        <p className="p-3 text-sm text-muted">Map the Claim ID field to this widget.</p>
      )}
      <ClaimEvidence claimId={claimId} showHistory={false} />
    </div>
  );
}

export const evidenceWidget: EvidenceWidgetDef = {
  id: 'bountyline-evidence',
  label: 'Claim evidence',
  comp: EvidenceWidget,
  dataMapping: { claimId: { type: 'field', supportedRoles: ['category'], required: true } },
  form: (p) =>
    p.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [{ key: 'claimId', label: 'Claim ID' }],
    }),
  defaultSize: { width: 8, height: 30 },
  minSize: { width: 5, height: 14 },
};
