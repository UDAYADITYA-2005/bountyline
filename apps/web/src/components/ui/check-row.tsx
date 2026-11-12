import type { CheckView } from '@bountyline/contracts';
import { TONE_CLASSES } from './status-badge';

const STATUS_META: Record<
  CheckView['status'],
  { word: string; glyph: string; tone: keyof typeof TONE_CLASSES }
> = {
  pending: { word: 'Checking', glyph: '…', tone: 'info' },
  pass: { word: 'Pass', glyph: '✓', tone: 'pass' },
  fail: { word: 'Fail', glyph: '✕', tone: 'fail' },
  uncertain: { word: 'Unsure', glyph: '?', tone: 'hold' },
  skipped: { word: 'Skipped', glyph: '–', tone: 'skip' },
  unavailable: { word: 'Unavailable', glyph: '!', tone: 'hold' },
};

/** One check with its result. Status is spoken as a word and a glyph, never colour alone. */
export function CheckRow({ check, simulatedNote }: { check: CheckView; simulatedNote?: string }) {
  const meta = STATUS_META[check.status];
  return (
    <li
      className="flex items-start gap-3 border-b border-line py-3 last:border-b-0"
      data-status={check.status}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-base font-bold ${TONE_CLASSES[meta.tone]} ${check.status === 'pending' ? 'bl-pulse' : ''}`}
      >
        {meta.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">{check.label}</span>
          <span className="text-sm font-semibold">
            {meta.word}
            {check.confidence !== undefined && check.status !== 'pending' ? (
              <span className="ml-1 font-normal text-muted">
                ({Math.round(check.confidence * 100)}%)
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted">{check.detail}</p>
        {simulatedNote ? (
          <p className="mt-1 inline-block rounded-sm bg-skip-soft px-1.5 py-0.5 text-xs font-semibold text-skip">
            {simulatedNote}
          </p>
        ) : null}
      </div>
    </li>
  );
}
