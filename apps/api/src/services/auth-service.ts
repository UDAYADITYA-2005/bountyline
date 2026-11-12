import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { LoginBody, RegisterBody } from '@bountyline/contracts';
import { DomainError } from '@bountyline/core';
import {
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  type UserRecord,
} from '@bountyline/db';
import { SESSION_TTL_MS } from '../auth.js';
import type { AppDeps } from '../deps.js';

/** Opaque session IDs: 32 random bytes, base64url. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export class AuthService {
  constructor(private readonly deps: AppDeps) {}

  async register(body: RegisterBody): Promise<{ user: UserRecord; sessionId: string }> {
    const { db, clock, ids } = this.deps;
    // A Judge mode deployment hands out manager sessions to anyone, so it must hold demo data only.
    if (this.deps.config.JUDGE_MODE) {
      throw new DomainError(
        'FORBIDDEN',
        'Registration is closed on the demo deployment. Use Judge mode to try a claim.',
      );
    }
    if (await findUserByEmail(db.db, body.email))
      throw new DomainError('EMAIL_TAKEN', 'That email already has an account.');
    const now = clock.now();
    const user = await createUser(db.db, {
      id: ids.next(),
      email: body.email,
      role: 'claimant',
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      paypalEmail: body.paypalEmail,
      ageAttestedAt: body.ageAttested ? now : null,
      createdAt: now,
    });
    return { user, sessionId: await this.startSession(user.id) };
  }

  async login(body: LoginBody): Promise<{ user: UserRecord; sessionId: string }> {
    const user = await findUserByEmail(this.deps.db.db, body.email);
    // Verify against a dummy hash when the user is missing, so timing doesn't reveal accounts.
    const stored = user?.passwordHash ?? (await DUMMY_HASH);
    const ok = await verify(stored, body.password).catch(() => false);
    if (!user || !user.passwordHash || !ok)
      throw new DomainError('INVALID_CREDENTIALS', 'Email or password is wrong.');
    if (this.deps.config.JUDGE_MODE && user.role !== 'manager') {
      throw new DomainError(
        'FORBIDDEN',
        'Claimant accounts are closed on the demo deployment. Use Judge mode.',
      );
    }
    return { user, sessionId: await this.startSession(user.id) };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await deleteSession(this.deps.db.db, sessionId);
  }

  async startSession(userId: string): Promise<string> {
    const now = this.deps.clock.now();
    const id = newSessionId();
    await createSession(this.deps.db.db, {
      id,
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    return id;
  }
}

const DUMMY_HASH = hash('not-a-real-password-just-for-timing');
