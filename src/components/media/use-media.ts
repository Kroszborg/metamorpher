'use client';

import { useEffect, useState } from 'react';
import { type Capabilities, type MediaInfo, mediaEngine } from '@/engines/media';

/**
 * Probes a file with the media engine (cached per File). `deep` also asks
 * ffmpeg.wasm about files the fast engine cannot read (`mediaEngine.inspect`).
 */
export function useMediaInfo(file: File | null | undefined, deep = false): { info: MediaInfo | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ file: File | null; info: MediaInfo | null; error: string | null }>({
    file: null,
    info: null,
    error: null,
  });
  useEffect(() => {
    if (!file) return;
    let live = true;
    (deep ? mediaEngine.inspect(file) : mediaEngine.probe(file)).then(
      (info) => live && setState({ file, info, error: null }),
      (err: unknown) => live && setState({ file, info: null, error: err instanceof Error ? err.message : 'Could not read this file.' }),
    );
    return () => {
      live = false;
    };
  }, [file, deep]);
  if (!file) return { info: null, loading: false, error: null };
  const current = state.file === file;
  return { info: current ? state.info : null, loading: !current, error: current ? state.error : null };
}

/** What this browser's WebCodecs can encode; null until known. */
export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let live = true;
    mediaEngine.capabilities().then(
      (c) => live && setCaps(c),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

/** Evenly spaced frames across the whole video as object URLs (revoked on change); null while loading. */
export function useThumbnails(file: File | null | undefined, count: number, height = 72): string[] | null {
  const [state, setState] = useState<{ file: File; urls: string[] } | null>(null);
  useEffect(() => {
    if (!file) return;
    const abort = new AbortController();
    let urls: string[] = [];
    mediaEngine.thumbnails(file, count, height, abort.signal).then(
      (blobs) => {
        if (abort.signal.aborted) return;
        urls = blobs.map((b) => URL.createObjectURL(b));
        setState({ file, urls });
      },
      () => !abort.signal.aborted && setState({ file, urls: [] }),
    );
    return () => {
      abort.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [file, count, height]);
  return file && state?.file === file ? state.urls : null;
}

/** Audio peak levels across the whole file; null while loading, empty without audio. */
export function useWaveform(file: File | null | undefined, buckets: number, enabled = true): number[] | null {
  const [state, setState] = useState<{ file: File; peaks: number[] } | null>(null);
  useEffect(() => {
    if (!file || !enabled) return;
    const abort = new AbortController();
    mediaEngine.waveform(file, buckets, abort.signal).then(
      (peaks) => !abort.signal.aborted && setState({ file, peaks }),
      () => !abort.signal.aborted && setState({ file, peaks: [] }),
    );
    return () => abort.abort();
  }, [file, buckets, enabled]);
  return file && enabled && state?.file === file ? state.peaks : null;
}
