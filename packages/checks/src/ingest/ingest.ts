import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { dHashFromGrid, pHashFromGrid } from './hash.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// The capture flow sends JPEG; PNG and WebP are accepted for tests and tooling. No HEIF: less decoder surface.
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

export class PhotoRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoRejected';
  }
}

export interface IngestedPhoto {
  jpeg: Buffer;
  sha256: string;
  phash: bigint;
  dhash: bigint;
  width: number;
  height: number;
}

/**
 * Normalises an upload: type checked by content, decoded, rotated by EXIF, resized to 1600 px on
 * the long side, re-encoded as JPEG q85 with all metadata stripped. Hashes are of the result.
 */
export async function ingestPhoto(input: Uint8Array): Promise<IngestedPhoto> {
  if (input.byteLength === 0) throw new PhotoRejected('empty file');
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new PhotoRejected('file over 8 MB');
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw new PhotoRejected('not an image');
  }
  if (!format || !ACCEPTED.has(format))
    throw new PhotoRejected(`unsupported image type ${format ?? 'unknown'}`);

  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoRejected('image could not be decoded');
  }
  return {
    jpeg: out.data,
    sha256: createHash('sha256').update(out.data).digest('hex'),
    ...(await hashesOf(out.data)),
    width: out.info.width,
    height: out.info.height,
  };
}

/** dHash and pHash of an image. */
export async function hashesOf(image: Buffer): Promise<{ phash: bigint; dhash: bigint }> {
  const grid = async (w: number, h: number) =>
    new Uint8Array(
      await sharp(image)
        .removeAlpha()
        .grayscale()
        .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
        .raw()
        .toBuffer(),
    );
  const [d, p] = await Promise.all([grid(9, 8), grid(32, 32)]);
  return { dhash: dHashFromGrid(d), phash: pHashFromGrid(p) };
}
