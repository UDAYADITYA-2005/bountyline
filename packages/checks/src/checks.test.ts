import { loadPrograms, repoPaths } from '@bountyline/config';
import type { Program } from '@bountyline/core';
import type { DuplicateCandidate } from '@bountyline/db';
import { describe, expect, it } from 'vitest';
import { syntheticPhoto } from '../test/photos.js';
import {
  areaCheck,
  claimRateCheck,
  codeExpiryCheck,
  declaredLengthCheck,
  duplicateCheck,
  seasonCheck,
} from './deterministic.js';
import { dHashFromGrid, hammingDistance, pHashFromGrid } from './ingest/hash.js';
import { PhotoRejected, ingestPhoto } from './ingest/ingest.js';

const programs = loadPrograms(repoPaths().programsDir);
const pikeminnow = programs.find((p) => p.id === 'columbia-pikeminnow') as Program;
const pike = programs.find((p) => p.id === 'lake-roosevelt-pike') as Program;

const cand = (distance: number, sameSha = false): DuplicateCandidate => ({
  claimId: 'C1',
  photoId: 'P1',
  distance,
  sameSha,
});

describe('duplicate check', () => {
  it.each([
    [0, 'fail', 'duplicate_exact'],
    [6, 'fail', 'duplicate_exact'],
    [7, 'uncertain', 'duplicate_near'],
    [12, 'uncertain', 'duplicate_near'],
    [13, 'pass', undefined],
  ])('pHash distance %i gives %s', (d, status, reason) => {
    const r = duplicateCheck([cand(d)], pikeminnow.decisionPolicy);
    expect([r.status, r.reason]).toEqual([status, reason]);
  });

  it('rejects the same SHA-256 whatever the distance', () => {
    expect(duplicateCheck([cand(30, true)], pikeminnow.decisionPolicy).reason).toBe(
      'duplicate_exact',
    );
  });

  it('passes with no earlier photos', () => {
    expect(duplicateCheck([], pikeminnow.decisionPolicy).status).toBe('pass');
  });
});

describe('geofence', () => {
  it.each([
    ['Kennewick on the Columbia', pikeminnow, 46.2205, -119.1725, 'pass'],
    ['below Bonneville Dam', pikeminnow, 45.639, -121.945, 'pass'],
    ['Seattle', pikeminnow, 47.6062, -122.3321, 'fail'],
    ['Kettle Falls on Lake Roosevelt', pike, 48.6, -118.1, 'pass'],
    ['Spokane', pike, 47.6588, -117.426, 'fail'],
  ])('%s is %s', (_name, program, lat, lng, status) => {
    expect(areaCheck({ lat, lng, accuracyM: 10 }, program).status).toBe(status);
  });

  it('holds when the location is too inaccurate', () => {
    const r = areaCheck({ lat: 46.2205, lng: -119.1725, accuracyM: 151 }, pikeminnow);
    expect([r.status, r.reason]).toEqual(['uncertain', 'low_location_accuracy']);
  });

  it('holds when no location was sent', () => {
    expect(areaCheck(null, pikeminnow).status).toBe('uncertain');
  });

  it('rounds coordinates in the detail', () => {
    expect(
      areaCheck({ lat: 47.606234, lng: -122.332123, accuracyM: 5 }, pikeminnow).detail,
    ).toContain('47.606, -122.332');
  });
});

describe('season, rate, expiry and declared length', () => {
  it.each([
    ['2026-10-01T07:00:00Z', 'pass'],
    ['2026-10-01T06:59:59Z', 'fail'],
    ['2027-02-01T07:59:59Z', 'pass'],
    ['2027-02-01T08:00:00Z', 'fail'],
  ])('season at %s is %s in Pacific time', (iso, status) => {
    expect(seasonCheck(new Date(iso), pikeminnow.season).status).toBe(status);
  });

  it('allows exactly the daily limit and holds one over', () => {
    expect(claimRateCheck(20, 20).status).toBe('pass');
    expect(claimRateCheck(21, 20)).toMatchObject({ status: 'fail', reason: 'claim_rate_exceeded' });
  });

  it('accepts a photo at the exact expiry and rejects one a millisecond late', () => {
    const exp = new Date('2026-11-11T18:15:00Z');
    expect(codeExpiryCheck(exp, exp).status).toBe('pass');
    expect(codeExpiryCheck(new Date(exp.getTime() + 1), exp)).toMatchObject({
      status: 'fail',
      reason: 'code_expired',
    });
  });

  it.each([
    [34, 22.9, 'pass'],
    [22.9, 22.9, 'pass'],
    [18, 22.9, 'fail'],
    [null, 22.9, 'uncertain'],
    [null, null, 'pass'],
  ])('declared %s cm against minimum %s is %s', (cm, min, status) => {
    expect(declaredLengthCheck(cm, min).status).toBe(status);
  });
});

describe('hashes and ingest', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0n, 0b111111n)).toBe(6);
    expect(hammingDistance(-1n, 0n)).toBe(64);
  });

  it('gives a flat image a stable dHash and pHash', () => {
    expect(dHashFromGrid(new Array(72).fill(128))).toBe(0n);
    expect(typeof pHashFromGrid(new Array(1024).fill(128))).toBe('bigint');
  });

  it('normalises an upload and keeps re-encodes of the same photo close', async () => {
    const original = await syntheticPhoto(1, { width: 2400, height: 1800 });
    const a = await ingestPhoto(original);
    expect(Math.max(a.width, a.height)).toBe(1600);
    expect(a.jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
    const recompressed = await ingestPhoto(
      await (await import('sharp')).default(original).jpeg({ quality: 60 }).toBuffer(),
    );
    expect(hammingDistance(a.phash, recompressed.phash)).toBeLessThanOrEqual(6);
    const other = await ingestPhoto(await syntheticPhoto(2));
    expect(hammingDistance(a.phash, other.phash)).toBeGreaterThan(12);
  });

  it('rejects files that are not images, and empty files', async () => {
    await expect(ingestPhoto(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(
      PhotoRejected,
    );
    await expect(ingestPhoto(new Uint8Array())).rejects.toBeInstanceOf(PhotoRejected);
  });

  it('rejects uploads over 8 MB before decoding', async () => {
    await expect(ingestPhoto(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow(/8 MB/);
  });
});
