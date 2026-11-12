import type { DeskTable } from '@bountyline/contracts';
import type { AgDataSourceDefinition, AgFieldDefinition } from 'ag-studio';
import { fetchDeskData } from '../api/hooks';
import type { DeskRegistry } from './widgets/widget-types';

type Row = Record<string, string | number | boolean | null | Date>;
type FieldSpec = [
  id: string,
  name: string,
  format: AgFieldDefinition<DeskRegistry>['format'],
  hide?: boolean,
];

const T = 'textFormat';
const N = 'decimalFormat';
const I = 'integerFormat';
const C = 'currencyFormat';
const D = 'dateTimeFormat';

// Display-only helper columns derived from the API's display numbers, so value widgets can sum
// them. Money logic never reads these; the decision and amounts come from the API.
const CLAIM_FIELDS: FieldSpec[] = [
  ['id', 'Claim ID', T],
  ['program', 'Program', T],
  ['programId', 'Program ID', T, true],
  ['claimant', 'Claimant', T],
  ['species', 'Species', T],
  ['lengthCm', 'Length (cm)', N],
  ['status', 'Status', T],
  ['decision', 'Decision', T],
  ['amountUsd', 'Amount', C],
  ['submittedAt', 'Submitted', D],
  ['decidedAt', 'Decided', D],
  ['lat', 'Latitude', N],
  ['lng', 'Longitude', N],
  ['holdReasons', 'Hold reasons', T],
  ['audit', 'Audit', T],
  ['source', 'Source', T],
  ['photoUrl', 'Photo', T, true],
  ['paidUsd', 'Paid amount', C],
  ['paidTodayUsd', 'Paid today', C],
  ['heldCount', 'Held', I],
  ['auditFlag', 'Audit requested (paid claims)', N],
  ['claimCount', 'Claims', I],
];

const TABLES: Record<DeskTable, { name: string; key: string; fields: FieldSpec[] }> = {
  claims: { name: 'Claims', key: 'id', fields: CLAIM_FIELDS },
  payouts: {
    name: 'Payouts',
    key: 'claimId',
    fields: [
      ['claimId', 'Claim ID', T],
      ['program', 'Program', T],
      ['status', 'Payout status', T],
      ['attempt', 'Attempt', I],
      ['tries', 'Tries', I],
      ['amountUsd', 'Amount', C],
      ['paypalBatchId', 'PayPal batch', T],
      ['paypalItemId', 'PayPal item', T],
      ['lastError', 'Last error', T],
      ['updatedAt', 'Updated', D],
    ],
  },
  ledger: {
    name: 'Ledger',
    key: 'id',
    fields: [
      ['id', 'Entry', I],
      ['program', 'Program', T],
      ['kind', 'Kind', T],
      ['amountUsd', 'Amount', C],
      ['signedAmountUsd', 'Pool effect', C],
      ['claimId', 'Claim ID', T],
      ['source', 'Source', T],
      ['createdAt', 'Created', D],
    ],
  },
  audits: {
    name: 'Audits',
    key: 'claimId',
    fields: [
      ['claimId', 'Claim ID', T],
      ['program', 'Program', T],
      ['claimant', 'Claimant', T],
      ['audit', 'Audit', T],
      ['amountUsd', 'Amount', C],
      ['paidAt', 'Paid', D],
    ],
  },
};

const isToday = (d: Date, now: Date): boolean => d.toDateString() === now.toDateString();

/** Turns ISO strings into Dates for datetime fields and adds the display helper columns. */
export function shapeRows(
  table: DeskTable,
  rows: Record<string, string | number | boolean | null>[],
  now = new Date(),
): Row[] {
  const dateIds = TABLES[table].fields.filter((f) => f[2] === D).map((f) => f[0]);
  return rows.map((raw) => {
    const row: Row = { ...raw };
    for (const id of dateIds) {
      const v = raw[id];
      row[id] = typeof v === 'string' ? new Date(v) : null;
    }
    if (table === 'claims') {
      const amount = typeof raw.amountUsd === 'number' ? raw.amountUsd : 0;
      const paid = raw.status === 'paid';
      const decided = row.decidedAt instanceof Date ? row.decidedAt : null;
      row.paidUsd = paid ? amount : 0;
      row.paidTodayUsd = paid && decided && isToday(decided, now) ? amount : 0;
      row.heldCount = raw.status === 'held' ? 1 : 0;
      row.auditFlag = paid ? (raw.audit === 'none' ? 0 : 1) : null;
      row.claimCount = 1;
    }
    return row;
  });
}

/** One async AG Studio data source per desk table, fetched from /api/v1/desk/data/:table. */
export function createDeskSources(
  getVersion: () => number,
): AgDataSourceDefinition<'row', DeskRegistry>[] {
  return (Object.keys(TABLES) as DeskTable[]).map((table) => {
    const def = TABLES[table];
    return {
      id: `bountyline-${table}`,
      name: def.name,
      dataShape: 'row',
      getVersion,
      tables: [
        {
          id: table,
          name: def.name,
          primaryKeyField: def.key,
          fields: def.fields.map(([id, name, format, hide]) => ({
            id,
            name,
            format,
            ...(hide ? { hide } : {}),
          })),
        },
      ],
      getData: async () => ({ data: shapeRows(table, await fetchDeskData(table)) }),
    };
  });
}
