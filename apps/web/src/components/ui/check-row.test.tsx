import type { CheckView } from '@bountyline/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckRow } from './check-row';
import { StatusBadge } from './status-badge';

afterEach(cleanup);

const WORDS: [CheckView['status'], string][] = [
  ['pending', 'Checking'],
  ['pass', 'Pass'],
  ['fail', 'Fail'],
  ['uncertain', 'Unsure'],
  ['skipped', 'Skipped'],
  ['unavailable', 'Unavailable'],
];

describe('CheckRow', () => {
  it.each(WORDS)('says %s in words, not only colour', (status, word) => {
    render(
      <ul>
        <CheckRow
          check={{ key: 'species', status, label: 'Species', detail: 'Northern pikeminnow' }}
        />
      </ul>,
    );
    expect(screen.getByText(word)).toBeTruthy();
    expect(screen.getByText('Northern pikeminnow')).toBeTruthy();
  });

  it('shows the confidence as a percentage', () => {
    render(
      <ul>
        <CheckRow
          check={{
            key: 'species',
            status: 'pass',
            confidence: 0.92,
            label: 'Species',
            detail: 'x',
          }}
        />
      </ul>,
    );
    expect(screen.getByText('(92%)')).toBeTruthy();
  });

  it('labels a simulated part', () => {
    render(
      <ul>
        <CheckRow
          check={{
            key: 'code_in_frame',
            status: 'skipped',
            label: 'Code in frame',
            detail: 'sample photo',
          }}
          simulatedNote="Skipped: sample photo has no code card"
        />
      </ul>,
    );
    expect(screen.getByText('Skipped: sample photo has no code card')).toBeTruthy();
  });
});

describe('StatusBadge', () => {
  it('names the status in words', () => {
    render(<StatusBadge status="held" />);
    expect(screen.getByText('Held for review')).toBeTruthy();
  });
});
