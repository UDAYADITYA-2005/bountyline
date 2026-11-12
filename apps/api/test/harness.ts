import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScenarioPack, parseEnv, repoPaths, type AppConfig } from '@bountyline/config';
import {
  CounterIdGenerator,
  FixedClock,
  SeededRandom,
  type VisionFindings,
} from '@bountyline/core';
import { FakeVisionProvider, cleanFindings, ingestPhoto } from '@bountyline/checks';
import { createTestDb, type DbHandle } from '@bountyline/db';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppDeps } from '../src/deps.js';
import { loadProgramRegistry } from '../src/production.js';
import { InlineCheckRunner } from '../src/runners.js';
import { seed } from '../src/seed.js';
import type { Services } from '../src/services.js';
import { syntheticPhoto } from '../../../packages/checks/test/photos.js';
import { TEST_WEBHOOK_ID, getTestCert } from '../../../packages/paypal/test/sign.js';
import { FakePayoutGateway } from './fakes.js';

export const ORIGIN = 'http://localhost:5173';
export const START = '2026-11-11T18:00:00Z';
export const MANAGER = { email: 'manager@bountyline.demo', password: 'manager-password-123' };
export const RECEIVER = 'sb-claimant@personal.example.com';

// One synthetic JPEG per sample photo name, so every scenario runs without the real photos.
const PHOTO_SEEDS: Record<string, number> = {
  'pikeminnow-01.jpg': 11,
  'pikeminnow-02.jpg': 12,
  'pikeminnow-03.jpg': 13,
  'pikeminnow-04.jpg': 14,
  'pikeminnow-05.jpg': 15,
  'lookalike-01.jpg': 16,
  'pike-01.jpg': 17,
};

let photosDirCache: Promise<{ dir: string; sha: Map<string, string> }> | null = null;
async function samplePhotos() {
  photosDirCache ??= (async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bl-photos-'));
    const sha = new Map<string, string>();
    for (const [name, s] of Object.entries(PHOTO_SEEDS)) {
      const bytes = await syntheticPhoto(s);
      writeFileSync(path.join(dir, name), bytes);
      sha.set(name, (await ingestPhoto(bytes)).sha256);
    }
    return { dir, sha };
  })();
  return photosDirCache;
}

export interface Harness {
  app: FastifyInstance;
  services: Services;
  deps: AppDeps;
  db: DbHandle;
  clock: FixedClock;
  gateway: FakePayoutGateway;
  vision: FakeVisionProvider;
  photoSha: Map<string, string>;
  close(): Promise<void>;
}

/** A full app on a fresh PGlite with fakes for PayPal and Gemini, seeded like `pnpm seed`. */
export async function createHarness(
  opts: { env?: Record<string, string>; rateLimits?: boolean; seedDb?: boolean } = {},
): Promise<Harness> {
  const config: AppConfig = parseEnv({
    PAYPAL_ENV: 'sandbox',
    NODE_ENV: 'test',
    JUDGE_MODE: 'true',
    APP_BASE_URL: ORIGIN,
    PAYPAL_WEBHOOK_ID: TEST_WEBHOOK_ID,
    DEMO_MANAGER_EMAIL: MANAGER.email,
    DEMO_CLAIMANT_PAYPAL_EMAIL: RECEIVER,
    LOG_LEVEL: 'silent',
    ...opts.env,
  });
  const db = await createTestDb();
  const clock = new FixedClock(START);
  const paths = repoPaths();
  const programs = await loadProgramRegistry(db, paths.programsDir, clock);
  const scenarios = loadScenarioPack(
    paths.scenariosFile,
    [...programs.values()].map((p) => p.program),
  );
  const photos = await samplePhotos();
  const vision = new FakeVisionProvider(new Map(), cleanFindings());
  vision.set(
    photos.sha.get('lookalike-01.jpg') ?? '',
    cleanFindings({
      species: { key: 'smallmouth_bass', commonName: 'Smallmouth bass', confidence: 0.93 },
    }),
  );
  vision.set(
    photos.sha.get('pike-01.jpg') ?? '',
    cleanFindings({
      species: { key: 'northern_pike', commonName: 'Northern pike', confidence: 0.95 },
    }),
  );
  const gateway = new FakePayoutGateway();
  const ids = new CounterIdGenerator('01K');
  const checkDeps = { db: db.db, vision, programs, clock, judgeMode: config.JUDGE_MODE };
  const deps: AppDeps = {
    config,
    db,
    programs,
    scenarios,
    photosDir: photos.dir,
    payoutGateway: gateway,
    vision,
    checkRunner: null as unknown as AppDeps['checkRunner'],
    clock,
    random: new SeededRandom(7),
    ids,
    getCert: getTestCert,
    webDist: null,
    version: 'test',
    rateLimits: opts.rateLimits ?? false,
    logger: false,
  };
  const { app, services } = await buildApp(deps);
  deps.checkRunner = new InlineCheckRunner(checkDeps, app.log, true);
  if (opts.seedDb !== false) {
    await seed({
      db: db.db,
      programs,
      scenarios,
      photosDir: photos.dir,
      clock,
      ids,
      manager: MANAGER,
    });
  }
  return {
    app,
    services,
    deps,
    db,
    clock,
    gateway,
    vision,
    photoSha: photos.sha,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** A tiny cookie-keeping client over app.inject, sending our Origin on every request. */
export class Client {
  private cookie = '';
  constructor(private readonly app: FastifyInstance) {}

  async req(
    method: InjectOptions['method'],
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      headers: { origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      ...(body !== undefined ? { payload: body as InjectOptions['payload'] } : {}),
    });
    const set = res.cookies.find((c) => c.name === 'bl_session');
    if (set) this.cookie = `bl_session=${set.value}`;
    return {
      status: res.statusCode,
      json: () => res.json() as Record<string, unknown> & { claim?: ClaimJson },
      raw: res,
    };
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) =>
    this.req('POST', url, body ?? {}, headers);
  get sessionCookie(): string {
    return this.cookie;
  }
}

export interface ClaimJson {
  id: string;
  status: string;
  code: string;
  decision?: string;
  amount?: { amountMinor: number; formatted: string };
  reasons: { code: string }[];
  checks: { key: string; status: string; detail: string }[];
  audit: string;
  location?: { lat: number; lng: number };
  photoUrl?: string;
}

export async function judgeClaimant(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const res = await c.post('/api/v1/judge/session', { as: 'claimant' });
  if (res.status !== 200) throw new Error(`judge session failed ${res.status}`);
  return c;
}

export async function managerClient(app: FastifyInstance): Promise<Client> {
  const c = new Client(app);
  const res = await c.post('/api/v1/auth/login', MANAGER);
  if (res.status !== 200) throw new Error(`manager login failed ${res.status}`);
  return c;
}

export async function runScenario(c: Client, id: string): Promise<ClaimJson> {
  const res = await c.post(`/api/v1/judge/scenarios/${id}/run`);
  if (res.status !== 201) throw new Error(`run ${id} failed ${res.status} ${res.raw.body}`);
  const claimId = (res.json().claim as ClaimJson).id;
  return (await c.get(`/api/v1/claims/${claimId}`)).json().claim as ClaimJson;
}

/** Multipart body with a photo and the meta JSON. */
export function evidencePayload(
  photo: Buffer,
  meta: unknown,
): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----bountyline-test';
  const head = (name: string, extra = '') =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n`;
  const body = Buffer.concat([
    Buffer.from(`${head('meta')}\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`${head('photo', '; filename="capture.jpg"')}Content-Type: image/jpeg\r\n\r\n`),
    photo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const findings = (o: Partial<VisionFindings>) => cleanFindings(o);
