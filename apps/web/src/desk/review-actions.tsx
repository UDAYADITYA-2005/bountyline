import { ClaimResponse, type ClaimView } from '@bountyline/contracts';
import { useState } from 'react';
import { apiRequest, errorMessage } from '../api/client';
import { emitDeskChanged } from './desk-events';

type Action = 'approve' | 'reject' | 'audit';

/**
 * Approve, reject or request an audit for one claim, with a required note. Calls the API, then
 * tells the desk to reload. Works inside Studio widgets (plain fetch, no React Query context).
 */
export function ReviewActions({ claim, compact = false }: { claim: ClaimView; compact?: boolean }) {
  const [open, setOpen] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reviewable = claim.status === 'held' || claim.status === 'payout_issue';
  const auditable = claim.status === 'paid' && claim.audit === 'none';
  const auditOpen = claim.status === 'paid' && claim.audit === 'requested';

  async function send(action: Action | 'pass' | 'fail'): Promise<void> {
    setBusy(true);
    setError(null);
    const id = encodeURIComponent(claim.id);
    try {
      if (action === 'approve' || action === 'reject') {
        await apiRequest(`/desk/claims/${id}/decision`, ClaimResponse, {
          method: 'POST',
          body: { decision: action, note: note.trim() },
        });
      } else {
        await apiRequest(`/desk/claims/${id}/audit`, ClaimResponse, {
          method: 'POST',
          body: {
            action: action === 'audit' ? 'request' : action,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      }
      setDone(
        action === 'approve'
          ? 'Approved: payout queued'
          : action === 'reject'
            ? 'Rejected'
            : 'Audit updated',
      );
      setOpen(null);
      setNote('');
      emitDeskChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = `rounded-sm px-3 font-semibold ${compact ? 'min-h-9 text-sm' : 'bl-touch'}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {reviewable ? (
          <>
            <button
              type="button"
              className={`${btn} bg-pass text-bg`}
              onClick={() => setOpen('approve')}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className={`${btn} bg-fail text-bg`}
              onClick={() => setOpen('reject')}
              disabled={busy}
            >
              Reject
            </button>
          </>
        ) : null}
        {auditable ? (
          <button
            type="button"
            className={`${btn} border border-line bg-surface`}
            onClick={() => setOpen('audit')}
            disabled={busy}
          >
            Request audit
          </button>
        ) : null}
        {auditOpen ? (
          <>
            <button
              type="button"
              className={`${btn} border border-pass text-pass`}
              onClick={() => void send('pass')}
              disabled={busy}
            >
              Audit passed
            </button>
            <button
              type="button"
              className={`${btn} border border-fail text-fail`}
              onClick={() => void send('fail')}
              disabled={busy}
            >
              Audit failed
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(open);
          }}
        >
          <label className="block text-sm font-semibold" htmlFor={`note-${claim.id}`}>
            Note for the decision log {open === 'audit' ? '(optional)' : '(required)'}
          </label>
          <textarea
            id={`note-${claim.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required={open !== 'audit'}
            maxLength={500}
            rows={2}
            className="w-full rounded-sm border border-line bg-surface p-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className={`${btn} bg-brand text-brand-ink`} disabled={busy}>
              {busy ? 'Saving…' : `Confirm ${open === 'audit' ? 'audit request' : open}`}
            </button>
            <button
              type="button"
              className={`${btn} border border-line`}
              onClick={() => setOpen(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-fail">
          ✕ {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm font-semibold text-pass">
          ✓ {done}
        </p>
      ) : null}
    </div>
  );
}
