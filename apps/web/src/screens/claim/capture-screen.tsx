import { ClaimResponse } from '@bountyline/contracts';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { errorMessage, uploadWithProgress } from '../../api/client';
import { useClaim } from '../../api/hooks';
import { Button, ErrorNote, Loading } from '../../components/ui/basics';
import { getLocation, grabFrame, type Fix } from '../../lib/capture';
import { RequireClaimant } from './require-claimant';
import { formatCountdown, useCountdown } from './start-claim-screen';

type CameraState = 'starting' | 'ready' | 'denied' | 'unsupported';

function useCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');
  useEffect(() => {
    if (!enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setState('ready');
      })
      .catch(() => setState('denied'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);
  return { videoRef, state };
}

function Capture({ id }: { id: string }) {
  const claim = useClaim(id);
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const camera = useCamera(photo === null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [length, setLength] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(claim.data?.codeExpiresAt);

  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  if (claim.isLoading) return <Loading />;
  if (claim.error || !claim.data)
    return <ErrorNote message={errorMessage(claim.error)} onRetry={() => void claim.refetch()} />;
  if (claim.data.status !== 'code_issued') return <Navigate to={`/claim/${id}`} replace />;

  async function shoot(): Promise<void> {
    const v = camera.videoRef.current;
    if (!v) return;
    try {
      const blob = await grabFrame(v);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setLocError(null);
      getLocation().then(setFix, (e: unknown) => setLocError(errorMessage(e)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit(): Promise<void> {
    if (!photo || !fix) return;
    setError(null);
    const meta = {
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      capturedAt: new Date().toISOString(),
      ...(length ? { declaredLengthCm: Number(length) } : {}),
    };
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    form.append('photo', photo.blob, 'evidence.jpg');
    try {
      setProgress(0);
      await uploadWithProgress(
        `/claims/${encodeURIComponent(id)}/evidence`,
        form,
        ClaimResponse,
        setProgress,
      );
      void navigate(`/claim/${id}`);
    } catch (e) {
      setProgress(null);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md bg-ink px-4 py-2 text-bg">
        <span className="font-mono text-2xl font-bold">{claim.data.code}</span>
        <span className="font-mono">{left > 0 ? formatCountdown(left) : 'expired'}</span>
      </div>

      {photo ? (
        <img
          src={photo.url}
          alt="Your evidence photo"
          className="w-full rounded-md border border-line"
        />
      ) : (
        <div className="relative overflow-hidden rounded-md bg-ink">
          <video
            ref={camera.videoRef}
            playsInline
            muted
            className="block aspect-[3/4] w-full object-cover sm:aspect-[4/3]"
            aria-label="Camera viewfinder"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[8%] rounded-md border-4 border-dashed border-accent"
          />
          <p className="absolute inset-x-0 bottom-2 text-center text-sm font-semibold text-bg">
            Whole fish, code card and board inside the frame
          </p>
          {camera.state !== 'ready' ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-bg">
              {camera.state === 'starting' ? 'Starting the camera…' : null}
              {camera.state === 'denied'
                ? 'Camera access was denied. Allow the camera for this site in your browser settings, then reload.'
                : null}
              {camera.state === 'unsupported'
                ? 'This browser cannot open the camera. Use a phone browser over HTTPS.'
                : null}
            </div>
          ) : null}
        </div>
      )}

      {photo ? (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
          <p role="status" className="text-sm">
            {fix
              ? `Location fixed to within ${fix.accuracyM} m.`
              : (locError ?? 'Getting your location…')}
          </p>
          {locError ? (
            <Button
              variant="secondary"
              onClick={() =>
                getLocation().then(setFix, (e: unknown) => setLocError(errorMessage(e)))
              }
            >
              Try location again
            </Button>
          ) : null}
          <div>
            <label htmlFor="len" className="block font-semibold">
              Length on the board (cm, optional)
            </label>
            <input
              id="len"
              inputMode="decimal"
              value={length}
              onChange={(e) => setLength(e.target.value.replace(/[^0-9.]/g, ''))}
              className="bl-touch mt-1 w-40 rounded-md border border-line bg-surface px-3 text-lg"
            />
          </div>
          {progress !== null ? (
            <div
              aria-label="Upload progress"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-3 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setPhoto(null);
                setFix(null);
              }}
              disabled={progress !== null}
            >
              Retake
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!fix || progress !== null || left === 0}
              className="flex-1 text-lg"
            >
              {progress !== null ? 'Uploading…' : 'Submit claim'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => void shoot()}
          disabled={camera.state !== 'ready' || left === 0}
          className="h-16 w-full text-xl"
          ariaLabel="Take photo"
        >
          <span aria-hidden="true" className="h-6 w-6 rounded-full border-4 border-brand-ink" />{' '}
          Take photo
        </Button>
      )}
      {error && !photo ? <ErrorNote message={error} /> : null}
    </div>
  );
}

export function CaptureScreen() {
  const { id = '' } = useParams();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="font-display text-2xl font-bold">Photograph your fish</h1>
      <RequireClaimant>
        <Capture id={id} />
      </RequireClaimant>
    </div>
  );
}
