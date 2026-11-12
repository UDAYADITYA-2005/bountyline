import { readFileSync } from 'node:fs';
import { FixedClock, money } from '@bountyline/core';
import { describe, expect, it } from 'vitest';
import { PayPalClient, type FetchLike } from '../src/client.js';
import { PayPalError, classifyError } from '../src/errors.js';
import { maskEmail, toPayPalValue } from '../src/money.js';
import { PayPalPayoutGateway, buildPayoutBody, outcomeOf } from '../src/payouts.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/paypal/${name}`, import.meta.url), 'utf8'));

const BASE = 'https://api-m.sandbox.paypal.com';
const clock = new FixedClock('2026-11-11T18:00:00Z');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function scripted(responses: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetchImpl, calls };
}

const token = () => json(200, { access_token: 'tok-1', expires_in: 32400 });

describe('toPayPalValue', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [99, '0.99'],
    [100, '1.00'],
    [600, '6.00'],
    [50000, '500.00'],
  ])('formats %i cents as %s', (cents, value) => {
    expect(toPayPalValue(cents)).toBe(value);
  });

  it.each([1.5, -1, Number.NaN])('refuses %s', (v) => {
    expect(() => toPayPalValue(v)).toThrow(RangeError);
  });

  it('masks emails', () => {
    expect(maskEmail('angler@example.com')).toBe('a***@example.com');
    expect(maskEmail(null)).toBe('');
  });
});

describe('client', () => {
  it('refuses any base URL but the sandbox', () => {
    expect(
      () =>
        new PayPalClient({
          baseUrl: 'https://example.com',
          clientId: 'a',
          clientSecret: 'b',
          clock,
        }),
    ).toThrow(/sandbox/);
  });

  it('shares one in-flight token refresh and caches until 60 s before expiry', async () => {
    const { fetch, calls } = scripted([
      json(200, { access_token: 'tok', expires_in: 120 }),
      json(200, {}),
      json(200, {}),
    ]);
    const client = new PayPalClient({
      baseUrl: BASE,
      clientId: 'id',
      clientSecret: 'secret',
      clock: new FixedClock('2026-11-11T18:00:00Z'),
      fetch,
    });
    await Promise.all([client.request('GET', '/a'), client.request('GET', '/b')]);
    expect(calls.filter((c) => c.url.endsWith('/v1/oauth2/token'))).toHaveLength(1);
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer tok');
  });

  it('refreshes the token once it is within 60 s of expiry', async () => {
    const c = new FixedClock('2026-11-11T18:00:00Z');
    const { fetch, calls } = scripted([
      json(200, { access_token: 't1', expires_in: 120 }),
      json(200, {}),
      json(200, { access_token: 't2', expires_in: 120 }),
      json(200, {}),
    ]);
    const client = new PayPalClient({
      baseUrl: BASE,
      clientId: 'id',
      clientSecret: 's',
      clock: c,
      fetch,
    });
    await client.request('GET', '/x');
    c.advance(61_000);
    await client.request('GET', '/x');
    expect(calls.filter((x) => x.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });

  it('turns a thrown fetch into a retryable Network error', async () => {
    const { fetch } = scripted([token(), new TypeError('fetch failed')]);
    const client = new PayPalClient({
      baseUrl: BASE,
      clientId: 'id',
      clientSecret: 's',
      clock,
      fetch,
    });
    const err = await client.request('GET', '/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).kind).toBe('Network');
    expect((err as PayPalError).retryable).toBe(true);
  });
});

describe('error classification', () => {
  it('reads a duplicate sender_batch_id and the original batch from its link', () => {
    const e = classifyError(400, fixture('duplicate-batch-400.json'));
    expect(e.kind).toBe('DuplicateBatch');
    expect(e.existingBatchId).toBe('5UXD2E8A7EBQJ');
  });

  it.each([
    [500, {}, 'Server', true],
    [503, {}, 'Server', true],
    [429, {}, 'RateLimited', true],
    [401, { name: 'AUTHENTICATION_FAILURE' }, 'Auth', false],
    [422, { name: 'INSUFFICIENT_FUNDS' }, 'InsufficientFunds', false],
    [
      400,
      { name: 'VALIDATION_ERROR', details: [{ field: 'items[0].receiver', issue: 'invalid' }] },
      'Validation',
      false,
    ],
  ])('classifies %i %j as %s', (status, body, kind, retryable) => {
    const e = classifyError(status, body);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
  });

  it('never keeps the response body (it holds emails)', () => {
    const e = classifyError(400, {
      name: 'VALIDATION_ERROR',
      message: 'bad receiver angler@example.com',
    });
    expect(JSON.stringify(e)).not.toContain('angler@example.com');
    expect(e.message).not.toContain('angler@example.com');
  });
});

describe('payout gateway', () => {
  const req = {
    claimId: '01JC9Z6Q0M3V6T5K2W8N4R7Y1A',
    attempt: 0,
    receiver: 'buyer@example.com',
    amount: money(600),
    note: 'Bountyline claim 01JC9Z6Q0M3V6T5K2W8N4R7Y1A',
  };

  it('builds exactly the documented request', () => {
    expect(buildPayoutBody(req)).toEqual({
      sender_batch_header: {
        sender_batch_id: req.claimId,
        recipient_type: 'EMAIL',
        email_subject: 'Your Bountyline reward',
        email_message: `Claim ${req.claimId} was verified. Thank you.`,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: '6.00', currency: 'USD' },
          receiver: 'buyer@example.com',
          note: req.note,
          sender_item_id: req.claimId,
        },
      ],
    });
    expect(buildPayoutBody({ ...req, attempt: 2 }).sender_batch_header.sender_batch_id).toBe(
      `${req.claimId}-r2`,
    );
    expect(buildPayoutBody({ ...req, attempt: 2 }).items[0]?.sender_item_id).toBe(req.claimId);
  });

  it('creates a payout and reads the batch ID', async () => {
    const { fetch, calls } = scripted([token(), json(201, fixture('create-payout-201.json'))]);
    const gw = new PayPalPayoutGateway(
      new PayPalClient({ baseUrl: BASE, clientId: 'id', clientSecret: 's', clock, fetch }),
    );
    expect(await gw.createPayout(req)).toEqual({
      payoutBatchId: '5UXD2E8A7EBQJ',
      batchStatus: 'PENDING',
      alreadyExisted: false,
    });
    expect(calls[1]?.url).toBe(`${BASE}/v1/payments/payouts`);
  });

  it('treats a duplicate batch as already sent', async () => {
    const { fetch } = scripted([token(), json(400, fixture('duplicate-batch-400.json'))]);
    const gw = new PayPalPayoutGateway(
      new PayPalClient({ baseUrl: BASE, clientId: 'id', clientSecret: 's', clock, fetch }),
    );
    expect(await gw.createPayout(req)).toEqual({
      payoutBatchId: '5UXD2E8A7EBQJ',
      batchStatus: 'UNKNOWN',
      alreadyExisted: true,
    });
  });

  it('maps batch items by sender_item_id', async () => {
    const { fetch } = scripted([token(), json(200, fixture('get-batch-success.json'))]);
    const gw = new PayPalPayoutGateway(
      new PayPalClient({ baseUrl: BASE, clientId: 'id', clientSecret: 's', clock, fetch }),
    );
    const batch = await gw.getPayoutBatch('5UXD2E8A7EBQJ');
    expect(batch.items).toEqual([
      {
        payoutItemId: '8AELMXH8UB2P8',
        senderItemId: req.claimId,
        transactionStatus: 'SUCCESS',
        outcome: 'succeeded',
      },
    ]);
  });

  it.each([
    ['SUCCESS', 'succeeded'],
    ['UNCLAIMED', 'unclaimed'],
    ['ONHOLD', 'held'],
    ['PENDING', 'pending'],
    ['FAILED', 'failed'],
    ['RETURNED', 'failed'],
    ['BLOCKED', 'failed'],
    [undefined, 'pending'],
  ])('maps transaction_status %s to %s', (status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome);
  });
});
