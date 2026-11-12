import { createReadStream } from 'node:fs';
import {
  ClaimResponse,
  JudgeSessionBody,
  ScenariosResponse,
  UserResponse,
} from '@bountyline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Services } from '../services.js';
import { userView } from '../views.js';
import { setSessionCookie } from './cookie.js';

const IdParams = z.object({ id: z.string().min(1).max(64) });

/** Judge mode routes. Each one 404s with JUDGE_MODE_OFF unless JUDGE_MODE=true (in the service). */
export const judgeRoutes: FastifyPluginAsyncZod<Services> = async (app, s) => {
  app.post(
    '/judge/session',
    {
      config: { auth: 'public', rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: { tags: ['judge'], body: JudgeSessionBody, response: { 200: UserResponse } },
    },
    async (req, reply) => {
      const { user, sessionId } = await s.judge.createSession(req.body.as);
      setSessionCookie(reply, sessionId, s.deps.config.isProduction);
      return { user: userView(user) };
    },
  );

  app.get(
    '/judge/scenarios',
    {
      config: { auth: 'public' },
      schema: { tags: ['judge'], response: { 200: ScenariosResponse } },
    },
    async () => ({
      scenarios: s.judge.list(),
    }),
  );

  app.get(
    '/judge/scenarios/:id/photo',
    { config: { auth: 'public' }, schema: { tags: ['judge'], params: IdParams } },
    async (req, reply) => {
      const file = s.judge.photoPath(req.params.id);
      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .type('image/jpeg')
        .send(createReadStream(file));
    },
  );

  app.post(
    '/judge/scenarios/:id/run',
    {
      config: {
        auth: 'judge',
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (req) => req.user?.judgeSessionId ?? req.ip,
        },
      },
      schema: { tags: ['judge'], params: IdParams, response: { 201: ClaimResponse } },
    },
    async (req, reply) => {
      const claim = await s.judge.run(requireUser(req), req.params.id);
      return reply.status(201).send({ claim: await s.claims.view(claim, false) });
    },
  );
};
