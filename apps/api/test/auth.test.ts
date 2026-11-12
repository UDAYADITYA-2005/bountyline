import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syntheticPhoto } from '../../../packages/checks/test/photos.js';
import {
  Client,
  ORIGIN,
  createHarness,
  evidencePayload,
  findings,
  judgeClaimant,
  managerClient,
  type ClaimJson,
  type Harness,
} from './harness.js';

// A normal (non-Judge) deployment: registration and claimant logins are open.
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ env: { JUDGE_MODE: 'false' } });
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function registered(): Promise<Client> {
  n += 1;
  const c = new Client(h.app);
  const res = await c.post('/api/v1/auth/register', {
    email: `angler${n}@example.com`,
    displayName: `Angler ${n}`,
    password: 'a-long-password',
    paypalEmail: `angler${n}@example.com`,
    ageAttested: true,
  });
  expect(res.status).toBe(201);
  return c;
}

describe('health and docs', () => {
  it('reports ok with the database', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', version: 'test', judgeMode: false });
  });

  it('serves OpenAPI generated from the zod schemas', async () => {
    const doc = (await h.app.inject({ method: 'GET', url: '/api/openapi.json' })).json() as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/claims',
        '/api/v1/desk/claims/{id}/decision',
        '/api/v1/judge/scenarios/{id}/run',
      ]),
    );
  });

  it('answers unknown API routes with problem+json', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('auth', () => {
  it('registers, sets an httpOnly SameSite=Lax cookie, and masks emails', async () => {
    const c = new Client(h.app);
    const res = await c.post('/api/v1/auth/register', {
      email: 'Mixed@Example.com',
      displayName: 'M',
      password: 'a-long-password',
      paypalEmail: 'pay@example.com',
      ageAttested: false,
    });
    expect(res.status).toBe(201);
    const cookie = res.raw.cookies.find((x) => x.name === 'bl_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(res.json().user as { email: string; paypalEmailMasked: string }).toMatchObject({
      email: 'm***@example.com',
      paypalEmailMasked: 'p***@example.com',
    });
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('refuses a wrong password and an unknown email the same way', async () => {
    const c = new Client(h.app);
    expect(
      (
        await c.post('/api/v1/auth/login', { email: 'manager@bountyline.demo', password: 'wrong' })
      ).json().code,
    ).toBe('INVALID_CREDENTIALS');
    expect(
      (
        await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'wrong' })
      ).json().code,
    ).toBe('INVALID_CREDENTIALS');
  });

  it('refuses unsafe requests from another origin (CSRF)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example.com' },
      payload: { email: 'a@b.co', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    const none = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.co', password: 'x' },
    });
    expect(none.statusCode).toBe(403);
  });

  it('logs out', async () => {
    const c = await registered();
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('authorization', () => {
  it('keeps claimants off desk routes and anonymous users off claim routes', async () => {
    const c = await registered();
    expect((await c.get('/api/v1/desk/claims')).status).toBe(403);
    expect((await c.get('/api/v1/desk/data/claims')).status).toBe(403);
    expect(
      (await new Client(h.app).post('/api/v1/claims', { programId: 'columbia-pikeminnow' })).status,
    ).toBe(401);
  });

  it('keeps managers from starting claims', async () => {
    const m = await managerClient(h.app);
    expect((await m.post('/api/v1/claims', { programId: 'columbia-pikeminnow' })).status).toBe(403);
  });

  it('hides another claimant’s claim and photo behind a 404', async () => {
    const owner = await registered();
    const claim = (await owner.post('/api/v1/claims', { programId: 'columbia-pikeminnow' })).json()
      .claim as ClaimJson;
    const { body, headers } = evidencePayload(await syntheticPhoto(903), {
      lat: 46.2205,
      lng: -119.1725,
      accuracyM: 8,
      capturedAt: '2026-11-11T17:59:00Z',
      declaredLengthCm: 30,
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claim.id}/evidence`,
      headers: { ...headers, origin: ORIGIN, cookie: owner.sessionCookie },
      payload: body,
    });
    const photoUrl =
      ((await owner.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson).photoUrl ?? '';
    const other = await registered();
    expect((await other.get(`/api/v1/claims/${claim.id}`)).status).toBe(404);
    expect((await other.get(photoUrl)).status).toBe(404);
    expect((await owner.get(photoUrl)).status).toBe(200);
    expect((await (await managerClient(h.app)).get(photoUrl)).status).toBe(200);
  });
});

describe('Judge mode deployment', () => {
  it('closes registration and claimant logins, so it only ever holds demo data', async () => {
    const judge = await createHarness();
    try {
      const c = new Client(judge.app);
      const reg = await c.post('/api/v1/auth/register', {
        email: 'z@example.com',
        displayName: 'Z',
        password: 'a-long-password',
        paypalEmail: 'z@example.com',
        ageAttested: true,
      });
      expect([reg.status, reg.json().code]).toEqual([403, 'FORBIDDEN']);
      expect((await managerClient(judge.app)).sessionCookie).not.toBe('');
      const j = await judgeClaimant(judge.app);
      expect((await j.post('/api/v1/judge/scenarios/pike-clean/run')).status).toBe(201);
    } finally {
      await judge.close();
    }
  });
});

describe('claimant flow with a real upload', () => {
  it('issues a code, ingests the photo, reads the code in frame and approves', async () => {
    const c = await registered();
    const start = await c.post(
      '/api/v1/claims',
      { programId: 'columbia-pikeminnow' },
      { 'idempotency-key': 'start-1' },
    );
    expect(start.status).toBe(201);
    const claim = start.json().claim as ClaimJson;
    expect(claim.code).toMatch(/^[A-Z2-9]{2}-[A-Z2-9]{2}$/);
    const again = await c.post(
      '/api/v1/claims',
      { programId: 'columbia-pikeminnow' },
      { 'idempotency-key': 'start-1' },
    );
    expect((again.json().claim as ClaimJson).id).toBe(claim.id);

    const photo = await syntheticPhoto(901, { width: 3000, height: 2000 });
    const { ingestPhoto } = await import('@bountyline/checks');
    h.vision.set(
      (await ingestPhoto(photo)).sha256,
      findings({ code: { visible: true, text: claim.code.toLowerCase(), confidence: 0.9 } }),
    );
    const { body, headers } = evidencePayload(photo, {
      lat: 46.2205123,
      lng: -119.1725456,
      accuracyM: 8,
      capturedAt: '2026-11-11T17:59:00Z',
      declaredLengthCm: 34,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claim.id}/evidence`,
      headers: { ...headers, origin: ORIGIN, cookie: c.sessionCookie },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const after = (await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson;
    expect(after.status).toBe('approved');
    expect(after.checks.find((x) => x.key === 'code_in_frame')?.status).toBe('pass');
    expect(after.location).toEqual({ lat: 46.221, lng: -119.173, accuracyM: 8 });
    const mine = (await c.get('/api/v1/me/claims')).json() as {
      totals: {
        pending: { amountMinor: number };
        tierProgress: { programId: string; seasonCount: number }[];
      };
    };
    expect(mine.totals.pending.amountMinor).toBe(600);
    expect(
      mine.totals.tierProgress.find((t) => t.programId === 'columbia-pikeminnow')?.seasonCount,
    ).toBe(1);
  });

  it('holds an app claim whose code card is missing', async () => {
    const c = await registered();
    const claim = (await c.post('/api/v1/claims', { programId: 'columbia-pikeminnow' })).json()
      .claim as ClaimJson;
    const { body, headers } = evidencePayload(await syntheticPhoto(902), {
      lat: 46.2205,
      lng: -119.1725,
      accuracyM: 8,
      capturedAt: '2026-11-11T17:59:00Z',
      declaredLengthCm: 34,
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claim.id}/evidence`,
      headers: { ...headers, origin: ORIGIN, cookie: c.sessionCookie },
      payload: body,
    });
    const after = (await c.get(`/api/v1/claims/${claim.id}`)).json().claim as ClaimJson;
    expect(after.status).toBe('held');
    expect(after.reasons.map((r) => r.code)).toEqual(['code_missing']);
  });

  it('rejects a file that is not an image with 422', async () => {
    const c = await registered();
    const claim = (await c.post('/api/v1/claims', { programId: 'columbia-pikeminnow' })).json()
      .claim as ClaimJson;
    const { body, headers } = evidencePayload(Buffer.from('<html>not a photo</html>'), {
      lat: 46.2,
      lng: -119.1,
      accuracyM: 8,
      capturedAt: '2026-11-11T17:59:00Z',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claim.id}/evidence`,
      headers: { ...headers, origin: ORIGIN, cookie: c.sessionCookie },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('PHOTO_INVALID');
  });

  it('refuses the pike program to claimants who did not confirm 17+', async () => {
    const c = new Client(h.app);
    await c.post('/api/v1/auth/register', {
      email: 'young@example.com',
      displayName: 'Y',
      password: 'a-long-password',
      paypalEmail: 'young@example.com',
      ageAttested: false,
    });
    expect((await c.post('/api/v1/claims', { programId: 'lake-roosevelt-pike' })).json().code).toBe(
      'NOT_ELIGIBLE',
    );
  });
});

describe('judge mode off', () => {
  it('returns 404 JUDGE_MODE_OFF for every judge route', async () => {
    const off = await createHarness({ env: { JUDGE_MODE: 'false' }, seedDb: false });
    try {
      const c = new Client(off.app);
      for (const [method, url] of [
        ['POST', '/api/v1/judge/session'],
        ['GET', '/api/v1/judge/scenarios'],
        ['GET', '/api/v1/judge/scenarios/pike-clean/photo'],
      ] as const) {
        const res = await c.req(method, url, method === 'POST' ? { as: 'claimant' } : undefined);
        expect(res.status, url).toBe(404);
        expect(res.json().code).toBe('JUDGE_MODE_OFF');
      }
    } finally {
      await off.close();
    }
  });
});

describe('rate limits', () => {
  it('allows five logins a minute per IP, then 429 with Retry-After', async () => {
    const limited = await createHarness({ rateLimits: true, seedDb: false });
    try {
      const c = new Client(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 6; i += 1)
        codes.push(
          (await c.post('/api/v1/auth/login', { email: 'x@example.com', password: 'nope' })).status,
        );
      expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
      const last = await c.post('/api/v1/auth/login', { email: 'x@example.com', password: 'nope' });
      expect(last.raw.headers['retry-after']).toBeDefined();
      expect(last.json().code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});

describe('default deny', () => {
  it('serves the docs viewer publicly', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/docs/' });
    expect(res.statusCode).toBe(200);
  });
});
