'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type CompressOptions,
  type CompressResult,
  createImageEngine,
  type ImageEngine,
  imageErrorMessage,
} from '@/engines/image';
import { isAbortError } from '@/engines/worker-host';

/**
 * Two workers of their own, so previews never terminate a running job:
 * `quick` compresses a copy scaled to PROXY_SIDE (and keeps the decode), so
 * the picture follows the controls almost at once; `exact` compresses the
 * full image for the true size, and is cancelled whenever the settings move
 * on.
 */
const quick = createImageEngine();
const exact = createImageEngine();
/** Long side of the quick preview: sharper than the on-screen view, far smaller than a photo. */
const PROXY_SIDE = 1600;

export type CompressPreview = { result: CompressResult; url: string };

type Request = { key: string; file: File; options: CompressOptions };

/** Runs the newest request on `engine`, one at a time, without aborting (keeps the worker's cache). */
function queue(engine: ImageEngine, proxySide: number | undefined, done: (req: Request, r: CompressResult | Error) => void) {
  let running = false;
  let pending: Request | null = null;
  const pump = async () => {
    if (running || !pending) return;
    const req = pending;
    pending = null;
    running = true;
    try {
      done(req, await engine.compress(req.file, req.options, undefined, { cache: true, proxySide }));
    } catch (err) {
      done(req, err instanceof Error ? err : new Error(String(err)));
    } finally {
      running = false;
      void pump();
    }
  };
  return {
    push(req: Request) {
      pending = req;
      void pump();
    },
    get busy() {
      return running || pending !== null;
    },
  };
}

/**
 * Compresses `file` with `options` for the live before/after view. The
 * picture comes from a scaled-down copy within a few hundred milliseconds;
 * the size shown is always the real output's, computed in the background
 * (`exactPending` while it is not known yet).
 */
export function useCompressPreview(file: File | null, options: CompressOptions | null) {
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : '';
  const key = file && options ? `${fileKey}:${JSON.stringify(options)}` : '';
  const [quickState, setQuick] = useState<{ key: string; fileKey: string; preview?: CompressPreview; error?: string } | null>(null);
  const [exactState, setExact] = useState<{ key: string; preview?: CompressPreview; error?: string } | null>(null);
  const latest = useRef('');
  const urls = useRef<{ quick: string | null; exact: string | null }>({ quick: null, exact: null });
  const exactRun = useRef<{ key: string; abort: AbortController } | null>(null);

  const quickQueue = useRef<ReturnType<typeof queue> | null>(null);

  // The quick queue and the full-size runs only touch refs and state setters, so they are set up once.
  useEffect(() => {
    const publish = (slot: 'quick' | 'exact', result: CompressResult): CompressPreview => {
      const url = URL.createObjectURL(result.blob);
      const old = urls.current[slot];
      if (old) URL.revokeObjectURL(old);
      urls.current[slot] = url;
      return { result, url };
    };

    const runExact = (req: Request) => {
      exactRun.current?.abort.abort();
      const abort = new AbortController();
      exactRun.current = { key: req.key, abort };
      // A short pause first, so dragging a slider does not start (and kill) a full-size run per step.
      const timer = setTimeout(() => {
        exact
          .compress(req.file, req.options, abort.signal, { cache: true })
          .then((result) => {
            if (latest.current === req.key) setExact({ key: req.key, preview: publish('exact', result) });
          })
          .catch((err: unknown) => {
            if (!isAbortError(err) && latest.current === req.key) setExact({ key: req.key, error: imageErrorMessage(err) });
          })
          .finally(() => {
            if (exactRun.current?.abort === abort) exactRun.current = null;
          });
      }, 300);
      abort.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    };

    quickQueue.current = queue(quick, PROXY_SIDE, (req, r) => {
      const fk = `${req.file.name}:${req.file.size}:${req.file.lastModified}`;
      if (r instanceof Error) {
        if (latest.current === req.key) setQuick({ key: req.key, fileKey: fk, error: imageErrorMessage(r) });
        return;
      }
      if (latest.current !== req.key) return;
      const preview = publish('quick', r);
      setQuick({ key: req.key, fileKey: fk, preview });
      // Small images are compressed whole by the quick worker: that is the real result.
      if (!r.proxy) setExact({ key: req.key, preview });
      else if (exactRun.current?.key !== req.key) runExact(req);
    });
  }, []);

  useEffect(() => {
    latest.current = key;
    if (!file || !options) return;
    // Settings moved on: stop the full-size run now (it restarts once the quick preview is in).
    if (exactRun.current && exactRun.current.key !== key) {
      exactRun.current.abort.abort();
      exactRun.current = null;
    }
    const timer = setTimeout(() => quickQueue.current?.push({ key, file, options }), 120);
    return () => clearTimeout(timer);
  }, [key, file, options]);

  // Free previews and the workers' cached decodes on unmount.
  useEffect(
    () => () => {
      exactRun.current?.abort.abort();
      for (const url of [urls.current.quick, urls.current.exact]) if (url) URL.revokeObjectURL(url);
      urls.current = { quick: null, exact: null };
      void quick.release().catch(() => undefined);
      void exact.release().catch(() => undefined);
    },
    [],
  );

  const exactCurrent = exactState?.key === key ? exactState : null;
  const quickCurrent = quickState?.key === key ? quickState : null;
  const shown = exactCurrent?.preview ?? (quickState?.fileKey === fileKey ? quickState.preview : undefined) ?? null;
  return {
    /** The picture to show: the real result when known, otherwise the quick one (maybe for older settings). */
    preview: shown,
    /** The real output for the current settings (its size is the true size), once known. */
    exact: exactCurrent?.preview ?? null,
    error: exactCurrent?.error ?? quickCurrent?.error ?? null,
    /** The picture is catching up with the settings. */
    updating: !!key && !quickCurrent && !exactCurrent,
    /** The real size is still being computed. */
    exactPending: !!key && !exactCurrent,
  };
}
