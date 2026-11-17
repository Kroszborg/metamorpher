'use client';

import { Camera01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Why the camera cannot be used here, in words for the user. */
function cameraProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow it in the browser’s site settings, or add photos instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Add photos instead.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again, or add photos instead.';
  return 'The camera could not be started. Add photos instead.';
}

/**
 * Live camera with a capture button (getUserMedia, rear camera preferred).
 * Where there is no camera API (insecure page, old browser) or no camera,
 * it says so and the photo picker (which opens the camera app on phones)
 * remains.
 */
export function CameraCapture({ onCapture, disabled }: { onCapture: (file: File) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = () => {
    for (const t of stream.current?.getTracks() ?? []) t.stop();
    stream.current = null;
    setReady(false);
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'This browser cannot use the camera. Add photos instead.' : 'The camera needs a secure (https) page. Add photos instead.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      stream.current = s;
      setOpen(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      });
    } catch (err) {
      setError(cameraProblem(err));
    }
  };

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return;
    const n = count + 1;
    setCount(n);
    onCapture(new File([blob], `camera-${String(n).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
  };

  return (
    <div className="flex flex-col gap-2" data-camera="">
      {open ? (
        <div className="flex flex-col gap-2">
          <video ref={video} playsInline muted className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void capture()} disabled={!ready || disabled}>
              <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} />
              Capture page{count ? ` (${count})` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stop();
                setOpen(false);
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              Done
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void start()} disabled={disabled} className="self-start">
          <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} />
          Use camera
        </Button>
      )}
      {error ? (
        <p className="text-xs text-muted-foreground" data-camera-error="">
          {error}
        </p>
      ) : null}
    </div>
  );
}
