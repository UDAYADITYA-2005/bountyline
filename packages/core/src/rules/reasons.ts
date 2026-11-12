import { REASON_MESSAGES, type ReasonCode } from '@bountyline/contracts';

/** One plain sentence for a reason code. */
export function reasonMessage(code: ReasonCode): string {
  return REASON_MESSAGES[code];
}
