import { SeededRandom } from '@bountyline/core';
import sharp from 'sharp';

/** A deterministic synthetic JPEG: a blocky random pattern, distinct per seed. */
export async function syntheticPhoto(
  seed: number,
  size = { width: 640, height: 480 },
): Promise<Buffer> {
  const random = new SeededRandom(seed);
  const cols = 16;
  const rows = 12;
  const raw = Buffer.alloc(cols * rows * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Math.floor(random.next() * 256);
  return sharp(raw, { raw: { width: cols, height: rows, channels: 3 } })
    .resize(size.width, size.height, { kernel: 'nearest' })
    .jpeg({ quality: 90 })
    .toBuffer();
}
