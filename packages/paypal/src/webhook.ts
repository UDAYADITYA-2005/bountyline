import { createPublicKey, verify } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { z } from 'zod';
import type { FetchLike } from './client.js';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function header(h: WebhookHeaders, name: string): string | null {
  const v = h[name] ?? h[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** True when the cert URL is https and its host is paypal.com or ends with .paypal.com. */
export function isAllowedCertUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === 'paypal.com' || host.endsWith('.paypal.com');
}

/** Fetches PEM certs from allowed hosts only, with a 5 s timeout, cached by URL. */
export function createCertFetcher(fetchImpl: FetchLike = (u, i) => fetch(u, i)) {
  const cache = new Map<string, string>();
  return async (certUrl: string): Promise<string> => {
    if (!isAllowedCertUrl(certUrl)) throw new Error('cert URL not allowed');
    const hit = cache.get(certUrl);
    if (hit) return hit;
    const res = await fetchImpl(certUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
    if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
    const pem = await res.text();
    if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('cert is not PEM');
    cache.set(certUrl, pem);
    return pem;
  };
}

/**
 * Self-verifies a PayPal webhook: message = transmissionId|transmissionTime|webhookId|crc32(rawBody),
 * checked with SHA256withRSA against the cert from a *.paypal.com URL. Works for simulator events too.
 */
export async function verifyWebhook(input: {
  headers: WebhookHeaders;
  rawBody: Buffer;
  webhookId: string;
  getCert: (url: string) => Promise<string>;
}): Promise<VerifyResult> {
  const transmissionId = header(input.headers, 'paypal-transmission-id');
  const transmissionTime = header(input.headers, 'paypal-transmission-time');
  const signature = header(input.headers, 'paypal-transmission-sig');
  const certUrl = header(input.headers, 'paypal-cert-url');
  const algo = header(input.headers, 'paypal-auth-algo');
  if (!transmissionId || !transmissionTime || !signature || !certUrl) {
    return { ok: false, reason: 'missing signature headers' };
  }
  if (algo && algo.toUpperCase() !== 'SHA256WITHRSA')
    return { ok: false, reason: 'unsupported algorithm' };
  if (!isAllowedCertUrl(certUrl)) return { ok: false, reason: 'cert host not allowed' };

  let pem: string;
  try {
    pem = await input.getCert(certUrl);
  } catch {
    return { ok: false, reason: 'cert unavailable' };
  }
  const crc = crc32(input.rawBody) >>> 0;
  const message = `${transmissionId}|${transmissionTime}|${input.webhookId}|${crc}`;
  try {
    const ok = verify(
      'sha256',
      Buffer.from(message),
      createPublicKey(pem),
      Buffer.from(signature, 'base64'),
    );
    return ok ? { ok: true } : { ok: false, reason: 'bad signature' };
  } catch {
    return { ok: false, reason: 'bad signature' };
  }
}

const WebhookEventSchema = z.object({
  id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(128),
  resource: z
    .object({
      payout_item_id: z.string().optional(),
      transaction_status: z.string().optional(),
      payout_batch_id: z.string().optional(),
      payout_item: z.object({ sender_item_id: z.string().optional() }).passthrough().optional(),
      batch_header: z.object({ payout_batch_id: z.string().optional() }).passthrough().optional(),
      errors: z.object({ name: z.string().optional() }).passthrough().optional(),
    })
    .passthrough()
    .default({}),
});

export interface ParsedWebhookEvent {
  id: string;
  eventType: string;
  resourceId: string | null;
  payoutItemId: string | null;
  payoutBatchId: string | null;
  senderItemId: string | null;
  errorName: string | null;
  payload: unknown;
}

/** Parses the fields we use from a verified event body. */
export function parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent {
  const json: unknown = JSON.parse(rawBody.toString('utf8'));
  const e = WebhookEventSchema.parse(json);
  const r = e.resource;
  return {
    id: e.id,
    eventType: e.event_type,
    resourceId: r.payout_item_id ?? r.payout_batch_id ?? r.batch_header?.payout_batch_id ?? null,
    payoutItemId: r.payout_item_id ?? null,
    payoutBatchId: r.payout_batch_id ?? r.batch_header?.payout_batch_id ?? null,
    senderItemId: r.payout_item?.sender_item_id ?? null,
    errorName: r.errors?.name ?? null,
    payload: json,
  };
}

export type WebhookEffect =
  | { kind: 'paid' }
  | { kind: 'issue'; reason: 'payout_failed' | 'payout_unclaimed' }
  | { kind: 'held_by_paypal' }
  | { kind: 'log_only' };

/** What an event type means for the claim (docs/PAYPAL.md, events we handle). */
export function effectOf(eventType: string): WebhookEffect {
  switch (eventType) {
    case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
      return { kind: 'paid' };
    case 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED':
      return { kind: 'issue', reason: 'payout_unclaimed' };
    case 'PAYMENT.PAYOUTS-ITEM.FAILED':
    case 'PAYMENT.PAYOUTS-ITEM.RETURNED':
    case 'PAYMENT.PAYOUTS-ITEM.BLOCKED':
    case 'PAYMENT.PAYOUTS-ITEM.CANCELED':
    case 'PAYMENT.PAYOUTS-ITEM.REFUNDED':
    case 'PAYMENT.PAYOUTS-ITEM.DENIED':
      return { kind: 'issue', reason: 'payout_failed' };
    case 'PAYMENT.PAYOUTS-ITEM.HELD':
      return { kind: 'held_by_paypal' };
    default:
      return { kind: 'log_only' };
  }
}
