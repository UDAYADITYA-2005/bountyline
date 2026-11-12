import { loadEnv } from '@bountyline/config';
import { money } from '@bountyline/core';
import { createPayPalClient, maskEmail } from '@bountyline/paypal';
import { monotonicFactory } from 'ulid';
import { sleep } from './http.js';

// `pnpm paypal:smoke`: one real $1.00 sandbox payout to DEMO_CLAIMANT_PAYPAL_EMAIL, then polls the
// batch until the item leaves PENDING. Spends sandbox money only. Ask before running it.
const config = loadEnv();
if (
  !config.PAYPAL_CLIENT_ID ||
  !config.PAYPAL_CLIENT_SECRET ||
  !config.DEMO_CLAIMANT_PAYPAL_EMAIL
) {
  process.stderr.write(
    'Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and DEMO_CLAIMANT_PAYPAL_EMAIL in .env.\n',
  );
  process.exit(1);
}
const { gateway } = createPayPalClient({
  baseUrl: config.paypalBaseUrl,
  clientId: config.PAYPAL_CLIENT_ID,
  clientSecret: config.PAYPAL_CLIENT_SECRET,
  clock: { now: () => new Date() },
});
const claimId = `SMOKE${monotonicFactory()()}`;
const created = await gateway.createPayout({
  claimId,
  attempt: 0,
  receiver: config.DEMO_CLAIMANT_PAYPAL_EMAIL,
  amount: money(100),
  note: 'Bountyline smoke test',
});
process.stdout.write(
  `batch ${created.payoutBatchId} ${created.batchStatus} to ${maskEmail(config.DEMO_CLAIMANT_PAYPAL_EMAIL)}\n`,
);
for (let i = 0; i < 24; i += 1) {
  await sleep(5000);
  const batch = await gateway.getPayoutBatch(created.payoutBatchId);
  const item = batch.items.find((x) => x.senderItemId === claimId);
  process.stdout.write(
    `batch ${batch.batchStatus} item ${item?.transactionStatus ?? 'none yet'}\n`,
  );
  if (item && item.outcome !== 'pending') process.exit(item.outcome === 'succeeded' ? 0 : 1);
}
process.stderr.write('Item still pending after 2 minutes.\n');
process.exit(1);
