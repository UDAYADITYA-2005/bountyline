// Perceptual hashes over small grayscale pixel grids. Pure functions; sharp produces the grids.

/** 64-bit difference hash from a 9x8 grayscale grid (row-major, 72 values). */
export function dHashFromGrid(gray: Uint8Array | number[]): bigint {
  if (gray.length !== 72) throw new RangeError('dHash needs a 9x8 grid');
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = gray[y * 9 + x] ?? 0;
      const right = gray[y * 9 + x + 1] ?? 0;
      bits = (bits << 1n) | (left < right ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, bits);
}

const N = 32;
const COS: number[][] = Array.from({ length: 8 }, (_u, u) =>
  Array.from({ length: N }, (_x, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
);

/** 64-bit perceptual hash: 32x32 grayscale DCT, low 8x8 frequencies against their median. */
export function pHashFromGrid(gray: Uint8Array | number[]): bigint {
  if (gray.length !== N * N) throw new RangeError('pHash needs a 32x32 grid');
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      const cu = COS[u] ?? [];
      const cv = COS[v] ?? [];
      for (let y = 0; y < N; y += 1) {
        const cy = cu[y] ?? 0;
        for (let x = 0; x < N; x += 1) sum += (gray[y * N + x] ?? 0) * cy * (cv[x] ?? 0);
      }
      coeffs.push(sum);
    }
  }
  // The DC term (0,0) only measures brightness, so it is left out of the median.
  const sorted = coeffs.slice(1).sort((a, b) => a - b);
  const median = ((sorted[31] ?? 0) + (sorted[32] ?? 0)) / 2;
  let bits = 0n;
  for (const c of coeffs) bits = (bits << 1n) | (c > median ? 1n : 0n);
  return BigInt.asIntN(64, bits);
}

/** Number of differing bits between two 64-bit hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
