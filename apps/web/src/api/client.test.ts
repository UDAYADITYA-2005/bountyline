import { ProgramsResponse } from '@bountyline/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, problemFromBody } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('parses a problem+json body into an ApiError', () => {
    const e = problemFromBody(409, {
      type: 'https://bountyline.dev/problems/invalid-state',
      title: 'Invalid state',
      status: 409,
      detail: 'Cannot approve a paid claim',
      code: 'INVALID_STATE',
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('INVALID_STATE');
    expect(e.message).toBe('Cannot approve a paid claim');
  });

  it('falls back when the body is not a problem', () => {
    expect(problemFromBody(401, 'nope').code).toBe('UNAUTHENTICATED');
    expect(problemFromBody(502, undefined).code).toBe('UNKNOWN');
  });

  it('throws the API error code on a failed request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Judge mode is off',
              status: 404,
              detail: 'off',
              code: 'JUDGE_MODE_OFF',
            }),
            { status: 404, headers: { 'content-type': 'application/problem+json' } },
          ),
      ),
    );
    await expect(apiRequest('/judge/scenarios', ProgramsResponse)).rejects.toMatchObject({
      code: 'JUDGE_MODE_OFF',
      status: 404,
    });
  });

  it('rejects a response that does not match the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ programs: 'x' }), { status: 200 })),
    );
    await expect(apiRequest('/programs', ProgramsResponse)).rejects.toMatchObject({
      code: 'CONTRACT',
    });
  });

  it('reports offline when fetch itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(apiRequest('/programs', ProgramsResponse)).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });
});
