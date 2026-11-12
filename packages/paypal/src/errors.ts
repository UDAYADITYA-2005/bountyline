export type PayPalErrorKind =
  | 'DuplicateBatch'
  | 'Validation'
  | 'Auth'
  | 'InsufficientFunds'
  | 'RateLimited'
  | 'Server'
  | 'Network';

/** A typed PayPal failure. `name` is PayPal's error name; bodies are never kept (they hold emails). */
export class PayPalError extends Error {
  readonly kind: PayPalErrorKind;
  readonly status: number | null;
  readonly paypalName: string | null;
  readonly debugId: string | null;
  /** For DuplicateBatch: the existing batch ID read from the error's link, when present. */
  readonly existingBatchId: string | null;

  constructor(input: {
    kind: PayPalErrorKind;
    status: number | null;
    paypalName?: string | null;
    debugId?: string | null;
    existingBatchId?: string | null;
    message?: string;
  }) {
    super(
      input.message ?? `PayPal ${input.kind}${input.paypalName ? ` (${input.paypalName})` : ''}`,
    );
    this.name = 'PayPalError';
    this.kind = input.kind;
    this.status = input.status;
    this.paypalName = input.paypalName ?? null;
    this.debugId = input.debugId ?? null;
    this.existingBatchId = input.existingBatchId ?? null;
  }

  /** Network errors, timeouts, 5xx and 429 may be retried with the same sender_batch_id. */
  get retryable(): boolean {
    return this.kind === 'Network' || this.kind === 'Server' || this.kind === 'RateLimited';
  }
}

interface PayPalErrorBody {
  name?: unknown;
  message?: unknown;
  debug_id?: unknown;
  details?: unknown;
  links?: unknown;
}

function linksOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l) =>
      l && typeof l === 'object' && 'href' in l ? String((l as { href: unknown }).href) : '',
    )
    .filter(Boolean);
}

/**
 * Classifies an error response. A reused sender_batch_id comes back as a 4xx whose details name
 * the sender_batch_id; its link points at the original batch (verify against PayPal's reference).
 */
export function classifyError(status: number, body: unknown): PayPalError {
  const b = (body && typeof body === 'object' ? body : {}) as PayPalErrorBody;
  const paypalName = typeof b.name === 'string' ? b.name : null;
  const debugId = typeof b.debug_id === 'string' ? b.debug_id : null;
  const details = Array.isArray(b.details) ? (b.details as Record<string, unknown>[]) : [];
  const detailText = details
    .map((d) => `${String(d.field ?? '')} ${String(d.issue ?? '')} ${String(d.description ?? '')}`)
    .join(' ')
    .toLowerCase();

  if (status === 429) return new PayPalError({ kind: 'RateLimited', status, paypalName, debugId });
  if (status >= 500) return new PayPalError({ kind: 'Server', status, paypalName, debugId });
  if (
    status === 401 ||
    status === 403 ||
    paypalName === 'AUTHENTICATION_FAILURE' ||
    paypalName === 'NOT_AUTHORIZED'
  ) {
    return new PayPalError({ kind: 'Auth', status, paypalName, debugId });
  }
  const isDuplicate =
    detailText.includes('sender_batch_id') ||
    /already exists|duplicate/.test(detailText) ||
    paypalName === 'DUPLICATE_REQUEST_ID';
  if (
    isDuplicate &&
    (paypalName === 'USER_BUSINESS_ERROR' ||
      paypalName === 'DUPLICATE_REQUEST_ID' ||
      detailText.includes('sender_batch_id'))
  ) {
    const hrefs = [...details.flatMap((d) => linksOf(d.link ?? d.links)), ...linksOf(b.links)];
    const match = hrefs
      .map((h) => /\/v1\/payments\/payouts\/([A-Z0-9]+)/i.exec(h)?.[1])
      .find(Boolean);
    return new PayPalError({
      kind: 'DuplicateBatch',
      status,
      paypalName,
      debugId,
      existingBatchId: match ?? null,
    });
  }
  if (paypalName === 'INSUFFICIENT_FUNDS' || detailText.includes('insufficient')) {
    return new PayPalError({ kind: 'InsufficientFunds', status, paypalName, debugId });
  }
  return new PayPalError({ kind: 'Validation', status, paypalName, debugId });
}
