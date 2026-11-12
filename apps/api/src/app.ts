import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { HealthResponse } from '@bountyline/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authPlugin } from './auth.js';
import type { AppDeps } from './deps.js';
import { registerErrorHandler, problem } from './errors.js';
import { authRoutes } from './routes/auth-routes.js';
import { claimRoutes } from './routes/claim-routes.js';
import { deskRoutes } from './routes/desk-routes.js';
import { judgeRoutes } from './routes/judge-routes.js';
import { paypalWebhookRoute } from './routes/paypal-webhook.js';
import { createServices, type Services } from './services.js';

export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.secret',
  '*.token',
  '*.password',
  '*.email',
  '*.paypalEmail',
  '*.receiver',
];

/** The composition root: every outside dependency comes in through `deps`. */
export async function buildApp(
  deps: AppDeps,
): Promise<{ app: FastifyInstance; services: Services }> {
  // Render puts exactly one proxy in front; trusting more lets clients forge X-Forwarded-For.
  const proxyHops = deps.config.isProduction ? 1 : 0;
  const app = Fastify({
    logger: deps.logger === false ? false : { level: deps.config.LOG_LEVEL, redact: LOG_REDACT },
    trustProxy: (_address: string, hop: number) => hop < proxyHops,
    bodyLimit: 1024 * 1024,
    genReqId: () => deps.ids.next(),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  // Plugin routes (static web files, the API docs viewer) declare no auth level. They hold nothing
  // private, so mark them public; every route under /api/v1 must still declare its own (default deny).
  app.addHook('onRoute', (route) => {
    const isApiV1 = route.url.startsWith('/api/v1');
    if (!isApiV1 && route.config?.auth === undefined) {
      route.config = { ...route.config, auth: 'public' };
    }
  });

  const services = createServices(deps, app.log);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        // AG Studio and AG Grid inject styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  if (deps.rateLimits !== false)
    await app.register(rateLimit, {
      global: false,
      enableDraftSpec: false,
      errorResponseBuilder: (_req, ctx) => ({
        ...problem('RATE_LIMITED', `Try again in ${Math.ceil(ctx.ttl / 1000)} s.`),
        statusCode: 429,
      }),
    });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Bountyline API',
        version: deps.version,
        description: 'Wildlife bounty claims checked by AI and paid by PayPal (sandbox).',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs', uiConfig: { docExpansion: 'list' } });
  await app.register(authPlugin, deps);

  app.get(
    '/api/health',
    { config: { auth: 'public' }, schema: { tags: ['health'], response: { 200: HealthResponse } } },
    async () => {
      const ok = await deps.db.ping().catch(() => false);
      return {
        status: 'ok' as const,
        db: ok ? ('ok' as const) : ('error' as const),
        version: deps.version,
        judgeMode: deps.config.JUDGE_MODE,
      };
    },
  );
  app.get('/api/openapi.json', { config: { auth: 'public' }, schema: { hide: true } }, async () =>
    app.swagger(),
  );

  await app.register(
    async (v1) => {
      await v1.register(authRoutes, services);
      await v1.register(claimRoutes, services);
      await v1.register(deskRoutes, services);
      await v1.register(judgeRoutes, services);
      await v1.register(paypalWebhookRoute, services);
    },
    { prefix: '/api/v1' },
  );

  if (deps.webDist && existsSync(deps.webDist)) {
    await app.register(fastifyStatic, { root: deps.webDist, wildcard: false, index: false });
    // SPA fallback for client routes; everything under /api stays a JSON 404.
    app.get('/*', { config: { auth: 'public' }, schema: { hide: true } }, async (req, reply) => {
      if (req.url.startsWith('/api/'))
        return reply
          .status(404)
          .type('application/problem+json')
          .send(problem('NOT_FOUND', 'No such route.'));
      return reply.sendFile('index.html');
    });
  }

  return { app, services };
}
