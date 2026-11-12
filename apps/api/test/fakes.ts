import type {
  PayoutBatchStatus,
  PayoutCreated,
  PayoutGateway,
  PayoutRequest,
} from '@bountyline/core';
import { PayPalError } from '@bountyline/paypal';

type CreateStep = PayoutCreated | PayPalError | Error;
type BatchStep = PayoutBatchStatus | PayPalError;

/** Scripted PayoutGateway: answers each call from a queue (default success) and records requests. */
export class FakePayoutGateway implements PayoutGateway {
  readonly created: PayoutRequest[] = [];
  readonly polled: string[] = [];
  private readonly createSteps: CreateStep[] = [];
  private readonly batchSteps: BatchStep[] = [];
  private readonly batches = new Map<string, PayoutBatchStatus>();

  /** Answers getPayoutBatch for one batch ID. */
  setBatch(batch: PayoutBatchStatus): this {
    this.batches.set(batch.payoutBatchId, batch);
    return this;
  }

  onCreate(...steps: CreateStep[]): this {
    this.createSteps.push(...steps);
    return this;
  }

  onBatch(...steps: BatchStep[]): this {
    this.batchSteps.push(...steps);
    return this;
  }

  async createPayout(req: PayoutRequest): Promise<PayoutCreated> {
    this.created.push(req);
    const step = this.createSteps.shift();
    if (step instanceof Error) throw step;
    return (
      step ?? {
        payoutBatchId: `BATCH-${req.claimId}${req.attempt ? `-r${req.attempt}` : ''}`,
        batchStatus: 'PENDING',
        alreadyExisted: false,
      }
    );
  }

  async getPayoutBatch(batchId: string): Promise<PayoutBatchStatus> {
    this.polled.push(batchId);
    const known = this.batches.get(batchId);
    if (known) return known;
    const step = this.batchSteps.shift();
    if (step instanceof Error) throw step;
    return step ?? { payoutBatchId: batchId, batchStatus: 'PENDING', items: [] };
  }
}

export const serverError = () => new PayPalError({ kind: 'Server', status: 503 });
export const validationError = () =>
  new PayPalError({ kind: 'Validation', status: 422, paypalName: 'RECEIVER_UNREGISTERED' });
export const duplicateBatch = (batchId: string) =>
  new PayPalError({
    kind: 'DuplicateBatch',
    status: 400,
    paypalName: 'USER_BUSINESS_ERROR',
    existingBatchId: batchId,
  });
