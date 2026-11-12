import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../services.js';

/**
 * POST /api/v1/paypal/webhook. A route-scoped parser keeps the raw bytes, because the signature
 * covers the exact body. Verified by signature, so it skips the Origin check.
 */
export const paypalWebhookRoute: FastifyPluginAsync<Services> = async (app, s) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    '/paypal/webhook',
    {
      config: { auth: 'public', signatureVerified: true },
      schema: { tags: ['paypal'], hide: false },
    },
    async (req, reply) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await s.payouts.handleWebhook(raw, req.headers);
      return reply
        .status(result.status)
        .send(
          result.status === 200
            ? { received: true, replay: result.replay ?? false }
            : { received: false },
        );
    },
  );
};
