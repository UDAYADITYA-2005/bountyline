import type { AgReportState } from 'ag-studio';
import type { DeskRegistry } from './widgets/widget-types';

const kpi = (text: string, id: string, aggregation: 'sum' | 'avg' | 'count') => ({
  type: 'value' as const,
  format: { title: { enabled: true, text } },
  dataMapping: { value: [{ id, aggregation }] },
});

/** The desk's starting dashboard: KPIs, decisions over time, programs, the claims grid and both custom widgets. */
export const INITIAL_DESK_STATE: AgReportState<DeskRegistry> = {
  selectedPageId: 'overview',
  pages: [
    {
      id: 'overview',
      widgets: {
        'kpi-paid-today': kpi('Paid today', 'claims.paidTodayUsd', 'sum'),
        'kpi-held': kpi('Held for review', 'claims.heldCount', 'sum'),
        'kpi-pool': kpi('Pool available', 'ledger.signedAmountUsd', 'sum'),
        'kpi-audit': kpi('Audit rate (paid claims)', 'claims.auditFlag', 'avg'),
        'decisions-over-time': {
          type: 'column-chart-stacked',
          format: { title: { enabled: true, text: 'Claims by decision over time' } },
          dataMapping: {
            categoryKey: [{ id: 'claims.submittedAt' }],
            valueKey: [{ id: 'claims.claimCount', aggregation: 'sum' }],
            legendKey: [{ id: 'claims.decision' }],
          },
        },
        'by-program': {
          type: 'donut-chart',
          format: { title: { enabled: true, text: 'Claims by program' } },
          dataMapping: {
            categoryKey: [{ id: 'claims.program' }],
            valueKey: [{ id: 'claims.claimCount', aggregation: 'sum' }],
          },
        },
        'claims-grid': {
          type: 'grid',
          format: {
            title: { enabled: true, text: 'Claims (click a row to see its evidence)' },
            triggerCrossFilter: true,
          },
          dataMapping: {
            cols: [
              'id',
              'program',
              'species',
              'lengthCm',
              'status',
              'decision',
              'amountUsd',
              'submittedAt',
              'holdReasons',
              'audit',
            ].map((id) => ({ id: `claims.${id}` })),
          },
        },
        evidence: {
          type: 'bountyline-evidence',
          format: { title: { enabled: true, text: 'Evidence' } },
          dataMapping: { claimId: [{ id: 'claims.id' }] },
        },
        'review-queue': {
          type: 'bountyline-review-queue',
          format: { title: { enabled: true, text: 'Review queue' } },
          dataMapping: {},
        },
      },
      widgetLayout: {
        'kpi-paid-today': { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 6 },
        'kpi-held': { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 6 },
        'kpi-pool': { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 6 },
        'kpi-audit': { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 6 },
        'review-queue': { xTrack: 0, yTrack: 6, xSpan: 12, ySpan: 22 },
        evidence: { xTrack: 12, yTrack: 6, xSpan: 12, ySpan: 40 },
        'claims-grid': { xTrack: 0, yTrack: 28, xSpan: 12, ySpan: 18 },
        'decisions-over-time': { xTrack: 0, yTrack: 46, xSpan: 14, ySpan: 18 },
        'by-program': { xTrack: 14, yTrack: 46, xSpan: 10, ySpan: 18 },
      },
    },
  ],
};
