import type { FastifyReply } from 'fastify';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../auth.js';

/** The session cookie: httpOnly, SameSite=Lax, Secure in production, 7 days. */
export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}
