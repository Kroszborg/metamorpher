'use client';

import { useEffect, useState } from 'react';
import { browserCanShow, createImageEngine, imageErrorMessage, type ImageProbe } from '@/engines/image';
import { isAbortError } from '@/engines/worker-host';

/**
 * A separate image engine for on-screen previews. Cancelling a preview
 * terminates only this worker, never the one a running job uses.
 */
const previewEngine = createImageEngine();

export type ImagePreview = {
  /** Something an <img> can show (the file itself, or a JPEG/PNG rendering). */
  url: string;
  /** Displayed size of the full image (orientation applied). */
  width: number;
  height: number;
  probe: ImageProbe;
};

/**
 * Loads a displayable preview of `file`. Formats the browser shows natively
 * use the file's own object URL; HEIC and the rest are rendered by the engine
 * at up to `maxSide` pixels. URLs are revoked when the file changes or on unmount.
 */
export function useImagePreview(file: File | null, maxSide = 2048) {
  const [state, setState] = useState<{ file: File; preview?: ImagePreview; error?: string } | null>(null);

  useEffect(() => {
    if (!file) return;
    const abort = new AbortController();
    let url: string | null = null;
    (async () => {
      // Probing is quick; not passing the signal avoids restarting the worker on every change.
      const probe = await previewEngine.probe(file);
      if (abort.signal.aborted) return;
      let preview: ImagePreview;
      if (browserCanShow(probe.format) && probe.width > 0 && probe.format !== 'svg') {
        url = URL.createObjectURL(file);
        preview = { url, width: probe.width, height: probe.height, probe };
      } else {
        const r = await previewEngine.preview(file, maxSide, abort.signal);
        url = URL.createObjectURL(r.blob);
        preview = { url, width: r.width, height: r.height, probe: { ...probe, width: r.width, height: r.height } };
      }
      if (!abort.signal.aborted) setState({ file, preview });
    })().catch((err: unknown) => {
      if (!abort.signal.aborted && !isAbortError(err)) setState({ file, error: imageErrorMessage(err) });
    });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, maxSide]);

  const current = state && state.file === file ? state : null;
  return {
    preview: current?.preview ?? null,
    error: current?.error ?? null,
    loading: !!file && !current,
  };
}

/** Header facts (format, displayed size, animation) of `file`, read without decoding pixels. */
export function useImageProbe(file: File | null): ImageProbe | null {
  const [state, setState] = useState<{ file: File; probe: ImageProbe } | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    previewEngine
      .probe(file)
      .then((probe) => live && setState({ file, probe }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  return state && state.file === file ? state.probe : null;
}
