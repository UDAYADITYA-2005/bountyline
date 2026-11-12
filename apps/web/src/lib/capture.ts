export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.9;

/** Scales a frame so its longest side is at most MAX_SIDE, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Draws the current video frame to a canvas and encodes it as JPEG (quality 0.9). */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available in this browser.'));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export type Fix = { lat: number; lng: number; accuracyM: number };

/** One high-accuracy location fix, with accuracy in metres. */
export function getLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser has no location service.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
        }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Allow location for this site so the program area can be checked.'
              : 'Could not get a location fix. Move to open sky and try again.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
