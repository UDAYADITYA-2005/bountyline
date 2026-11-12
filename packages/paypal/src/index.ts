import type { Clock } from '@bountyline/core';
import { PayPalClient, type FetchLike } from './client.js';
import { PayPalPayoutGateway } from './payouts.js';

export * from './money.js';
export * from './errors.js';
export * from './client.js';
export * from './payouts.js';
export * from './webhook.js';

/** Builds the sandbox payout gateway from config values. */
export function createPayPalClient(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  clock: Clock;
  fetch?: FetchLike;
}): { client: PayPalClient; gateway: PayPalPayoutGateway } {
  const client = new PayPalClient(input);
  return { client, gateway: new PayPalPayoutGateway(client) };
}
