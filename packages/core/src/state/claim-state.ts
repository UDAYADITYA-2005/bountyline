import { FINAL_CLAIM_STATUSES, type ClaimStatus } from '@bountyline/contracts';
import { DomainError } from '../errors.js';

export type ClaimEvent =
  | 'evidence'
  | 'expire'
  | 'decide_approve'
  | 'decide_hold'
  | 'decide_reject'
  | 'manager_approve'
  | 'manager_reject'
  | 'dispatch'
  | 'paid'
  | 'payout_failed';

/**
 * Every legal arrow of the claim state machine (docs/ARCHITECTURE.md). Two arrows are additions
 * that keep money facts true: `approved --paid--> paid` covers a webhook that lands before the
 * dispatcher records `paying`, and `payout_issue --paid--> paid` covers an unclaimed payout that
 * the receiver later claims. PayPal saying money moved always wins over our earlier view.
 */
const TRANSITIONS: Readonly<Record<ClaimStatus, Partial<Record<ClaimEvent, ClaimStatus>>>> = {
  code_issued: { evidence: 'checking', expire: 'expired' },
  checking: { decide_approve: 'approved', decide_hold: 'held', decide_reject: 'rejected' },
  held: { manager_approve: 'approved', manager_reject: 'rejected' },
  approved: { dispatch: 'paying', paid: 'paid', payout_failed: 'payout_issue' },
  paying: { paid: 'paid', payout_failed: 'payout_issue' },
  payout_issue: { manager_approve: 'approved', manager_reject: 'rejected', paid: 'paid' },
  paid: {},
  rejected: {},
  expired: {},
};

/** Returns the next state, or throws INVALID_STATE for an illegal move. */
export function transition(state: ClaimStatus, event: ClaimEvent): ClaimStatus {
  const next = TRANSITIONS[state][event];
  if (!next) {
    throw new DomainError('INVALID_STATE', `Cannot apply ${event} to a claim in ${state}`, {
      state,
      event,
    });
  }
  return next;
}

/** True if the event is legal from the state. */
export function canTransition(state: ClaimStatus, event: ClaimEvent): boolean {
  return TRANSITIONS[state][event] !== undefined;
}

/** True for paid, rejected and expired. */
export function isFinal(state: ClaimStatus): boolean {
  return FINAL_CLAIM_STATUSES.includes(state);
}

/** All arrows, for tests and docs. */
export function allTransitions(): { from: ClaimStatus; event: ClaimEvent; to: ClaimStatus }[] {
  const out: { from: ClaimStatus; event: ClaimEvent; to: ClaimStatus }[] = [];
  for (const [from, events] of Object.entries(TRANSITIONS) as [
    ClaimStatus,
    Partial<Record<ClaimEvent, ClaimStatus>>,
  ][]) {
    for (const [event, to] of Object.entries(events) as [ClaimEvent, ClaimStatus][]) {
      out.push({ from, event, to });
    }
  }
  return out;
}
