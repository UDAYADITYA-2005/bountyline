# PayPal integration

Sandbox only. Payouts sends money out; webhooks confirm it; the reconciler covers lost webhooks.
Orders v2 (money in) is a stretch. Facts below were checked against PayPal's docs on Oct 25 and 26,
2026; re-check anything marked "verify".

## Sandbox set-up

1. Developer dashboard → Sandbox → Apps & Credentials → create a **Merchant** app on the default
   sandbox business account. Copy the client ID and secret into `.env` and Render.
2. The default sandbox personal account is the claimant's receiver in Judge mode. Put its email
   in `DEMO_CLAIMANT_PAYPAL_EMAIL`.
3. After the first deploy, add a sandbox webhook under the app: URL
   `https://<service>.onrender.com/api/v1/paypal/webhook`, events `PAYMENT.PAYOUTSBATCH.*` and
   `PAYMENT.PAYOUTS-ITEM.*`. Copy the webhook ID into `PAYPAL_WEBHOOK_ID`.
4. Verify: if the first payout returns an authorization error, check the app's features for
   Payouts. If it returns insufficient funds, add funds to the sandbox business account.

## Calls we make

Base URL: `https://api-m.sandbox.paypal.com` (from config).

### OAuth

`POST /v1/oauth2/token`, Basic auth `client_id:secret`, body `grant_type=client_credentials`.
Response `{ access_token, expires_in }`. Cache until 60 s before expiry.

### Create payout (one batch per claim)

`POST /v1/payments/payouts`

```json
{
  "sender_batch_header": {
    "sender_batch_id": "01JC9Z6Q0M3V6T5K2W8N4R7Y1A",
    "recipient_type": "EMAIL",
    "email_subject": "Your Bountyline reward",
    "email_message": "Claim 01JC9Z6Q0M3V6T5K2W8N4R7Y1A was verified. Thank you."
  },
  "items": [
    {
      "recipient_type": "EMAIL",
      "amount": { "value": "8.00", "currency": "USD" },
      "receiver": "angler@example.com",
      "note": "Bountyline claim 01JC9Z6Q0M3V6T5K2W8N4R7Y1A",
      "sender_item_id": "01JC9Z6Q0M3V6T5K2W8N4R7Y1A"
    }
  ]
}
```

Response 201: `batch_header.payout_batch_id`, `batch_header.batch_status` (usually `PENDING`).

Facts that shape the design:

- PayPal rejects a `sender_batch_id` used in the last 30 days, and the error links to the original
  payout. So the claim ID as `sender_batch_id` makes a retry safe, and a duplicate error means
  "already sent".
- After a 5xx, the docs say the request can be retried with the same `sender_batch_id`.
- `recipient_type` can be `EMAIL`, `PHONE`, `PAYPAL_ID` or a Venmo handle; the sandbox does not
  support `PHONE`. We use `EMAIL`.
- The `PayPal-Request-Id` header is optional here (PayPal stores keys for 30 days); duplicate
  protection relies on `sender_batch_id`.

### Read a payout

- `GET /v1/payments/payouts/{payout_batch_id}`: batch status plus items, each with
  `payout_item_id`, `transaction_status` and `payout_item.sender_item_id`.
- `GET /v1/payments/payouts-item/{payout_item_id}`: one item. Verify field names against the
  reference before coding the reconciler.

## Webhooks

### Events we handle

| Event                                                                        | Claim transition                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`                                             | `paying → paid`                                                                                    |
| `PAYMENT.PAYOUTS-ITEM.FAILED`, `RETURNED`, `BLOCKED`, `CANCELED`, `REFUNDED` | `paying → payout_issue` (reason `payout_failed`)                                                   |
| `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`                                             | `paying → payout_issue` (reason `payout_unclaimed`); the receiver has no PayPal account yet        |
| `PAYMENT.PAYOUTS-ITEM.HELD`                                                  | stays `paying`; the desk shows "held by PayPal"                                                    |
| `PAYMENT.PAYOUTSBATCH.PROCESSING`, `SUCCESS`, `DENIED`                       | logged; batch events carry no item details, so items are resolved by item events or the reconciler |

### Verification: self-verify, not postback

PayPal offers two methods. We self-verify, because events from the dashboard's webhook simulator
can't be verified by posting back to `verify-webhook-signature`, and self-verification works for
both real and simulated events.

1. Keep the raw request body as bytes (register a buffer content-type parser on this route only).
2. Read headers `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`,
   `paypal-cert-url`, `paypal-auth-algo`.
3. Reject unless `paypal-cert-url` is `https:` and its host ends with `.paypal.com`. Fetch the PEM
   and cache it by URL.
4. `crc = zlib.crc32(rawBody)` (Node 22 has `zlib.crc32`; use the unsigned decimal value).
5. `message = transmissionId + "|" + transmissionTime + "|" + PAYPAL_WEBHOOK_ID + "|" + crc`.
6. `crypto.verify('sha256', Buffer.from(message), crypto.createPublicKey(certPem),
Buffer.from(transmissionSig, 'base64'))` must return true (the algorithm header says
   `SHA256withRSA`).
7. Only then parse the JSON and store it.

Tests use a self-signed test cert and fixtures signed with it; the cert host check is a separate
unit test.

### Processing

Insert into `webhook_events` with `ON CONFLICT DO NOTHING`; if nothing was inserted, return 200
(replay). Otherwise, in one transaction, find the claim by `resource.payout_item.sender_item_id`
(fall back to `payout_item_id` on the job), apply the transition if it is legal from the current
state, write `decision_log`, and set `processed_at`. A final state never moves backwards.

## Reconciler

Every 60 s: jobs with `status = 'sent'` and `updated_at` older than 2 minutes →
`GET /v1/payments/payouts/{payout_batch_id}` → apply the same mapping as the webhook. Jobs stuck in
`sending` for 2 minutes go back to `queued`.

## Manual smoke test (`pnpm paypal:smoke`)

Creates a throwaway claim in the local database, sends a $1.00 payout to
`DEMO_CLAIMANT_PAYPAL_EMAIL` through the real sandbox, polls the batch until the item leaves
`PENDING`, and prints the item status. Ask before running it.

## Stretch: fund the pool with Checkout

`@paypal/paypal-server-sdk` (`OrdersController.createOrder` and `captureOrder`, client built with
`clientCredentialsAuthCredentials` and `Environment.Sandbox`) on the server, PayPal buttons on the
desk. A capture writes a ledger `funding` entry with `source = checkout:<order id>`, after the
`PAYMENT.CAPTURE.COMPLETED` webhook. The APIMatic Context Plugin covers this SDK; it does not cover
Payouts.
