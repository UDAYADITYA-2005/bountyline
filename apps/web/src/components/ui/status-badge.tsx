import type { ClaimStatus } from '@bountyline/contracts';

type Tone = 'pass' | 'fail' | 'hold' | 'info' | 'skip';

const STATUS: Record<ClaimStatus, { label: string; tone: Tone; glyph: string }> = {
  code_issued: { label: 'Code issued', tone: 'info', glyph: '#' },
  checking: { label: 'Checking', tone: 'info', glyph: '…' },
  approved: { label: 'Approved', tone: 'pass', glyph: '✓' },
  paying: { label: 'Paying', tone: 'info', glyph: '→' },
  paid: { label: 'Paid', tone: 'pass', glyph: '$' },
  held: { label: 'Held for review', tone: 'hold', glyph: '!' },
  payout_issue: { label: 'Payout issue', tone: 'fail', glyph: '!' },
  rejected: { label: 'Rejected', tone: 'fail', glyph: '✕' },
  expired: { label: 'Expired', tone: 'skip', glyph: '–' },
};

export const TONE_CLASSES: Record<Tone, string> = {
  pass: 'bg-pass-soft text-pass border-pass',
  fail: 'bg-fail-soft text-fail border-fail',
  hold: 'bg-hold-soft text-hold border-hold',
  info: 'bg-info-soft text-info border-info',
  skip: 'bg-skip-soft text-skip border-skip',
};

/** Claim status pill. The glyph and the word carry the meaning, not only the colour. */
export function StatusBadge({ status, size = 'md' }: { status: ClaimStatus; size?: 'sm' | 'md' }) {
  const s = STATUS[status];
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${pad} ${TONE_CLASSES[s.tone]}`}
    >
      <span aria-hidden="true" className="font-mono">
        {s.glyph}
      </span>
      {s.label}
    </span>
  );
}

export function statusLabel(status: ClaimStatus): string {
  return STATUS[status].label;
}
