import { generateKeyPairSync, sign } from 'node:crypto';
import { crc32 } from 'node:zlib';

// Test signing helper. Keys are generated at runtime so no key material lives in the repo. The
// verifier accepts the public key PEM the same way it accepts PayPal's X.509 cert.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const TEST_CERT_URL = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test';
export const TEST_WEBHOOK_ID = 'WH-TEST-0001';

export function signWebhook(
  event: unknown,
  opts: { certUrl?: string; webhookId?: string; transmissionId?: string; time?: string } = {},
): { rawBody: Buffer; headers: Record<string, string> } {
  const rawBody = Buffer.from(JSON.stringify(event));
  const transmissionId = opts.transmissionId ?? 'tx-1';
  const time = opts.time ?? '2026-11-11T18:00:00Z';
  const message = `${transmissionId}|${time}|${opts.webhookId ?? TEST_WEBHOOK_ID}|${crc32(rawBody) >>> 0}`;
  const sig = sign('sha256', Buffer.from(message), privateKey).toString('base64');
  return {
    rawBody,
    headers: {
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': time,
      'paypal-transmission-sig': sig,
      'paypal-cert-url': opts.certUrl ?? TEST_CERT_URL,
      'paypal-auth-algo': 'SHA256withRSA',
    },
  };
}

export const getTestCert = async (url: string): Promise<string> => {
  if (url !== TEST_CERT_URL) throw new Error('unknown cert');
  return TEST_PUBLIC_PEM;
};

export function itemEvent(type: string, claimId: string, id = `WH-${type}-${claimId}`) {
  return {
    id,
    event_type: type,
    resource_type: 'payouts_item',
    resource: {
      payout_item_id: `ITEM-${claimId}`,
      transaction_status: type.split('.').pop(),
      payout_batch_id: `BATCH-${claimId}`,
      payout_item: {
        sender_item_id: claimId,
        receiver: 'buyer@example.com',
        recipient_type: 'EMAIL',
      },
    },
  };
}
