import { describe, expect, it } from 'vitest';
import {
  createCertFetcher,
  effectOf,
  isAllowedCertUrl,
  parseWebhookEvent,
  verifyWebhook,
} from '../src/webhook.js';
import { TEST_WEBHOOK_ID, getTestCert, itemEvent, signWebhook } from './sign.js';

const event = itemEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED', 'CLAIM1');

async function check(signed: ReturnType<typeof signWebhook>, webhookId = TEST_WEBHOOK_ID) {
  return verifyWebhook({ ...signed, webhookId, getCert: getTestCert });
}

describe('webhook self-verification', () => {
  it('accepts a correctly signed event', async () => {
    expect(await check(signWebhook(event))).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const signed = signWebhook(event);
    const tampered = Buffer.from(signed.rawBody.toString().replace('CLAIM1', 'CLAIM2'));
    expect(await check({ ...signed, rawBody: tampered })).toEqual({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('rejects a different webhook ID', async () => {
    expect(await check(signWebhook(event), 'WH-OTHER')).toEqual({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('rejects a cert from a host outside paypal.com, before fetching it', async () => {
    let fetched = false;
    const signed = signWebhook(event, { certUrl: 'https://evil.example.com/cert.pem' });
    const r = await verifyWebhook({
      ...signed,
      webhookId: TEST_WEBHOOK_ID,
      getCert: async () => {
        fetched = true;
        return '';
      },
    });
    expect(r).toEqual({ ok: false, reason: 'cert host not allowed' });
    expect(fetched).toBe(false);
  });

  it('rejects missing headers', async () => {
    const signed = signWebhook(event);
    const { ['paypal-transmission-sig']: _sig, ...rest } = signed.headers;
    expect(await check({ ...signed, headers: rest })).toEqual({
      ok: false,
      reason: 'missing signature headers',
    });
  });

  it.each([
    ['https://api.sandbox.paypal.com/v1/notifications/certs/X', true],
    ['https://api.paypal.com/v1/notifications/certs/X', true],
    ['http://api.paypal.com/cert', false],
    ['https://paypal.com.evil.net/cert', false],
    ['https://evilpaypal.com/cert', false],
    ['https://user@api.paypal.com/cert', false],
    ['https://api.paypal.com:8443/cert', false],
    ['not a url', false],
  ])('allows cert URL %s: %s', (url, ok) => {
    expect(isAllowedCertUrl(url)).toBe(ok);
  });

  it('caches certs by URL and refuses disallowed hosts', async () => {
    let calls = 0;
    const fetcher = createCertFetcher(async () => {
      calls += 1;
      return new Response('-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----');
    });
    const url = 'https://api.sandbox.paypal.com/v1/notifications/certs/C';
    await fetcher(url);
    await fetcher(url);
    expect(calls).toBe(1);
    await expect(fetcher('https://example.com/c')).rejects.toThrow(/not allowed/);
  });
});

describe('event parsing and effects', () => {
  it('reads the claim ID from sender_item_id', () => {
    const parsed = parseWebhookEvent(Buffer.from(JSON.stringify(event)));
    expect(parsed).toMatchObject({
      id: event.id,
      eventType: event.event_type,
      senderItemId: 'CLAIM1',
      payoutItemId: 'ITEM-CLAIM1',
    });
  });

  it.each([
    ['PAYMENT.PAYOUTS-ITEM.SUCCEEDED', { kind: 'paid' }],
    ['PAYMENT.PAYOUTS-ITEM.FAILED', { kind: 'issue', reason: 'payout_failed' }],
    ['PAYMENT.PAYOUTS-ITEM.RETURNED', { kind: 'issue', reason: 'payout_failed' }],
    ['PAYMENT.PAYOUTS-ITEM.BLOCKED', { kind: 'issue', reason: 'payout_failed' }],
    ['PAYMENT.PAYOUTS-ITEM.CANCELED', { kind: 'issue', reason: 'payout_failed' }],
    ['PAYMENT.PAYOUTS-ITEM.REFUNDED', { kind: 'issue', reason: 'payout_failed' }],
    ['PAYMENT.PAYOUTS-ITEM.UNCLAIMED', { kind: 'issue', reason: 'payout_unclaimed' }],
    ['PAYMENT.PAYOUTS-ITEM.HELD', { kind: 'held_by_paypal' }],
    ['PAYMENT.PAYOUTSBATCH.SUCCESS', { kind: 'log_only' }],
    ['SOMETHING.ELSE', { kind: 'log_only' }],
  ])('%s means %j', (type, effect) => {
    expect(effectOf(type)).toEqual(effect);
  });
});
