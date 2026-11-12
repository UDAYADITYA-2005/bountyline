import { describe, expect, it } from 'vitest';
import { shapeRows } from '../desk/data-sources';
import { singleClaimId } from '../desk/widgets/evidence-widget';
import { tierProgressText } from '../screens/claim/my-claims-screen';
import { fitWithin } from './capture';

const usd = (cents: number) => ({
  amountMinor: cents,
  currency: 'USD' as const,
  formatted: `$${(cents / 100).toFixed(2)}`,
});

describe('tier progress text', () => {
  it('shows the count against the current tier', () => {
    expect(
      tierProgressText({
        programId: 'p',
        seasonCount: 12,
        currentAmount: usd(600),
        nextTierAt: 26,
      }),
    ).toBe('12 of 25 at $6.00');
  });
  it('shows a flat or top tier without a ceiling', () => {
    expect(
      tierProgressText({
        programId: 'p',
        seasonCount: 3,
        currentAmount: usd(1000),
        nextTierAt: null,
      }),
    ).toBe('3 this season at $10.00');
  });
});

describe('capture sizing', () => {
  it.each([
    [4000, 3000, 1600, 1200],
    [3000, 4000, 1200, 1600],
    [1200, 900, 1200, 900],
  ])('fits %ix%i into %ix%i', (w, h, ew, eh) => {
    expect(fitWithin(w, h)).toEqual({ width: ew, height: eh });
  });
});

describe('evidence widget selection', () => {
  it('picks a claim only when exactly one is selected', () => {
    expect(singleClaimId([{ id: 'A' }], ['id'])).toBe('A');
    expect(singleClaimId([{ id: 'A' }, { id: 'A' }], ['id'])).toBe('A');
    expect(singleClaimId([{ id: 'A' }, { id: 'B' }], ['id'])).toBeNull();
    expect(singleClaimId([], ['id'])).toBeNull();
  });
});

describe('desk rows', () => {
  it('turns dates into Date objects and adds display helpers', () => {
    const now = new Date('2026-11-11T20:00:00Z');
    const [row] = shapeRows(
      'claims',
      [
        {
          id: 'C1',
          status: 'paid',
          audit: 'none',
          amountUsd: 6,
          decidedAt: '2026-11-11T19:00:00Z',
          submittedAt: '2026-11-11T18:59:00Z',
        },
      ],
      now,
    );
    expect(row?.decidedAt).toBeInstanceOf(Date);
    expect(row?.paidTodayUsd).toBe(6);
    expect(row?.heldCount).toBe(0);
    expect(row?.auditFlag).toBe(0);
  });
});
