import { LoginBody, RegisterBody, UserResponse } from '@bountyline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SESSION_COOKIE, requireUser } from '../auth.js';
import type { Services } from '../services.js';
import { userView } from '../views.js';
import { setSessionCookie } from './cookie.js';

export const authRoutes: FastifyPluginAsyncZod<Services> = async (app, s) => {
  const secure = s.deps.config.isProduction;

  app.post(
    '/auth/register',
    {
      config: { auth: 'public', rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: { tags: ['auth'], body: RegisterBody, response: { 201: UserResponse } },
    },
    async (req, reply) => {
      const { user, sessionId } = await s.auth.register(req.body);
      setSessionCookie(reply, sessionId, secure);
      return reply.status(201).send({ user: userView(user) });
    },
  );

  app.post(
    '/auth/login',
    {
      config: { auth: 'public', rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: LoginBody, response: { 200: UserResponse } },
    },
    async (req, reply) => {
      const { user, sessionId } = await s.auth.login(req.body);
      setSessionCookie(reply, sessionId, secure);
      return { user: userView(user) };
    },
  );

  app.post(
    '/auth/logout',
    { config: { auth: 'public' }, schema: { tags: ['auth'] } },
    async (req, reply) => {
      await s.auth.logout(req.cookies[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );

  app.get(
    '/auth/me',
    { config: { auth: 'any' }, schema: { tags: ['auth'], response: { 200: UserResponse } } },
    async (req) => ({
      user: userView(requireUser(req)),
    }),
  );
};
