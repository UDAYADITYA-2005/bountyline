import type { Money } from '../money/money.js';

/** Source of the current time. */
export interface Clock {
  now(): Date;
}

/** Source of randomness in [0, 1). */
export interface Random {
  next(): number;
}

/** Source of unique IDs (ULIDs in production). */
export interface IdGenerator {
  next(): string;
}

/** Fixed or manually advanced clock for tests. */
export class FixedClock implements Clock {
  private current: number;
  constructor(start: Date | string) {
    this.current = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  set(to: Date | string): void {
    this.current = new Date(to).getTime();
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/** Deterministic random numbers (mulberry32) for tests. */
export class SeededRandom implements Random {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** Sequential IDs for tests: prefix plus a zero-padded counter, 26 characters like a ULID. */
export class CounterIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'ID') {}
  next(): string {
    this.n += 1;
    return `${this.prefix}${String(this.n).padStart(26 - this.prefix.length, '0')}`;
  }
}

export interface PayoutRequest {
  claimId: string;
  attempt: number;
  receiver: string;
  amount: Money;
  note: string;
}

export interface PayoutCreated {
  payoutBatchId: string;
  batchStatus: string;
  /** True when PayPal already had this sender_batch_id. */
  alreadyExisted: boolean;
}

export type PayoutItemOutcome = 'succeeded' | 'pending' | 'held' | 'unclaimed' | 'failed';

export interface PayoutItemStatus {
  payoutItemId: string;
  senderItemId: string | null;
  transactionStatus: string;
  outcome: PayoutItemOutcome;
}

export interface PayoutBatchStatus {
  payoutBatchId: string;
  batchStatus: string;
  items: PayoutItemStatus[];
}

/** The only way money leaves the system. Implemented by packages/paypal. */
export interface PayoutGateway {
  createPayout(req: PayoutRequest): Promise<PayoutCreated>;
  getPayoutBatch(batchId: string): Promise<PayoutBatchStatus>;
}
