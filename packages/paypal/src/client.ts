import type { Clock } from '@bountyline/core';
import { z } from 'zod';
import { PayPalError, classifyError } from './errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PayPalClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  clock: Clock;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** A minimal PayPal REST client: OAuth token cache plus JSON requests with typed errors. */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: PayPalClientOptions) {
    if (!/^https:\/\/api-m\.sandbox\.paypal\.com$/.test(opts.baseUrl)) {
      // Refuse anything but the sandbox, even if config were bypassed.
      throw new Error('PayPal client only talks to the sandbox');
    }
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Returns a cached token, refreshing 60 s before expiry with one shared in-flight request. */
  async accessToken(): Promise<string> {
    const now = this.opts.clock.now().getTime();
    if (this.token && now < this.token.expiresAt - 60_000) return this.token.value;
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.send(`${this.opts.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw classifyError(res.status, body);
    const parsed = TokenResponse.parse(body);
    this.token = {
      value: parsed.access_token,
      expiresAt: this.opts.clock.now().getTime() + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  /** Sends an authenticated JSON request; returns the parsed body or throws PayPalError. */
  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const token = await this.accessToken();
    const res = await this.send(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const parsed: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401) this.token = null;
    if (!res.ok) throw classifyError(res.status, parsed);
    return parsed;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new PayPalError({
        kind: 'Network',
        status: null,
        message: `PayPal network error: ${(e as Error).name}`,
      });
    }
  }
}
