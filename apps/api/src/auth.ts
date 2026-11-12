import { DomainError } from '@bountyline/core';
import { getSessionUser, type UserRecord } from '@bountyline/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from './deps.js';

export const SESSION_COOKIE = 'bl_session';
export const SESSION_TTL_MS = 7 * 24 * 3600_000;

/** Auth level every route must declare in `config.auth`. Routes without one are denied. */
export type AuthLevel = 'public' | 'any' | 'claimant' | 'manager' | 'judge';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRecord | null;
  }
  interface FastifyContextConfig {
    auth?: AuthLevel;
    /** Skips the Origin check; only for the signature-verified PayPal webhook. */
    signatureVerified?: boolean;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The signed-in user, or a 401. */
export function requireUser(req: FastifyRequest): UserRecord {
  if (!req.user) throw new DomainError('UNAUTHENTICATED', 'Sign in first.');
  return req.user;
}

export const authPlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  const allowedOrigin = new URL(deps.config.APP_BASE_URL).origin;
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const cfg = req.routeOptions.config;
    // CSRF: unsafe methods must come from our own origin (the webhook is signature-checked instead).
    if (UNSAFE.has(req.method) && !cfg.signatureVerified && req.routeOptions.url) {
      const origin = req.headers.origin;
      if (origin !== allowedOrigin)
        throw new DomainError('FORBIDDEN', 'Cross-origin request refused.');
    }
    const sid = req.cookies[SESSION_COOKIE];
    if (sid && sid.length <= 128) {
      req.user = await getSessionUser(deps.db.db, sid, deps.clock.now());
    }
  });

  app.addHook('preHandler', async (req) => {
    if (!req.routeOptions.url) return; // 404 handler
    const level = req.routeOptions.config.auth;
    if (level === undefined) throw new DomainError('FORBIDDEN', 'Route has no auth level.');
    if (level === 'public') return;
    const user = requireUser(req);
    if (level === 'claimant' && user.role !== 'claimant')
      throw new DomainError('FORBIDDEN', 'Claimants only.');
    if (level === 'manager' && user.role !== 'manager')
      throw new DomainError('FORBIDDEN', 'Program managers only.');
    if (level === 'judge' && !user.judgeSessionId && user.role !== 'manager') {
      throw new DomainError('FORBIDDEN', 'Judge mode sessions only.');
    }
  });
});
