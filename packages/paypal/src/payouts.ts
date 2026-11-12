import type {
  PayoutBatchStatus,
  PayoutCreated,
  PayoutGateway,
  PayoutItemOutcome,
  PayoutRequest,
} from '@bountyline/core';
import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { PayPalError } from './errors.js';
import { toPayPalAmount } from './money.js';

/** sender_batch_id: the claim ID, or claimId-r{n} after a manager retry. */
export function senderBatchId(claimId: string, attempt: number): string {
  return attempt === 0 ? claimId : `${claimId}-r${attempt}`;
}

/** Builds exactly the create-payout body in docs/PAYPAL.md. */
export function buildPayoutBody(req: PayoutRequest) {
  return {
    sender_batch_header: {
      sender_batch_id: senderBatchId(req.claimId, req.attempt),
      recipient_type: 'EMAIL',
      email_subject: 'Your Bountyline reward',
      email_message: `Claim ${req.claimId} was verified. Thank you.`,
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: toPayPalAmount(req.amount),
        receiver: req.receiver,
        note: req.note.slice(0, 4000),
        sender_item_id: req.claimId,
      },
    ],
  };
}

const CreateResponse = z.object({
  batch_header: z.object({ payout_batch_id: z.string().min(1), batch_status: z.string() }),
});

const BatchResponse = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string(),
        transaction_status: z.string().optional(),
        payout_item: z.object({ sender_item_id: z.string().optional() }).passthrough().optional(),
      }),
    )
    .default([]),
});

/** Maps PayPal's item transaction_status to the outcome our state machine understands. */
export function outcomeOf(transactionStatus: string | undefined): PayoutItemOutcome {
  switch ((transactionStatus ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'succeeded';
    case 'UNCLAIMED':
      return 'unclaimed';
    case 'ONHOLD':
      return 'held';
    case 'FAILED':
    case 'RETURNED':
    case 'BLOCKED':
    case 'REFUNDED':
    case 'REVERSED':
    case 'DENIED':
    case 'CANCELED':
      return 'failed';
    default:
      return 'pending';
  }
}

/** The PayoutGateway backed by the PayPal sandbox. Only the payout dispatcher holds one. */
export class PayPalPayoutGateway implements PayoutGateway {
  constructor(private readonly client: PayPalClient) {}

  async createPayout(req: PayoutRequest): Promise<PayoutCreated> {
    try {
      const body = await this.client.request('POST', '/v1/payments/payouts', buildPayoutBody(req));
      const parsed = CreateResponse.parse(body);
      return {
        payoutBatchId: parsed.batch_header.payout_batch_id,
        batchStatus: parsed.batch_header.batch_status,
        alreadyExisted: false,
      };
    } catch (e) {
      if (e instanceof PayPalError && e.kind === 'DuplicateBatch') {
        return {
          payoutBatchId: e.existingBatchId ?? '',
          batchStatus: 'UNKNOWN',
          alreadyExisted: true,
        };
      }
      throw e;
    }
  }

  async getPayoutBatch(batchId: string): Promise<PayoutBatchStatus> {
    if (!/^[A-Za-z0-9]+$/.test(batchId)) throw new Error('invalid payout batch id');
    const parsed = BatchResponse.parse(
      await this.client.request('GET', `/v1/payments/payouts/${batchId}`),
    );
    return {
      payoutBatchId: parsed.batch_header.payout_batch_id,
      batchStatus: parsed.batch_header.batch_status,
      items: parsed.items.map((i) => ({
        payoutItemId: i.payout_item_id,
        senderItemId: i.payout_item?.sender_item_id ?? null,
        transactionStatus: i.transaction_status ?? 'UNKNOWN',
        outcome: outcomeOf(i.transaction_status),
      })),
    };
  }
}
