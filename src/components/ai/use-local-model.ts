'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  detectDevice,
  type DeviceInfo,
  type DevicePlan,
  getModel,
  hasStoredFiles,
  isMarkedDownloaded,
  localAi,
  type ModelSpec,
  type ModelTask,
  modelsFor,
  onModelsChanged,
  planDevice,
} from '@/engines/ai';
import { isAbortError } from '@/engines/worker-host';

const PREF = (k: string) => `metamorpher:ai-model:${k}`;
const PREF_EVENT = 'metamorpher:ai-model';

function readPref(k: string): string {
  try {
    return window.localStorage.getItem(PREF(k)) ?? '';
  } catch {
    return '';
  }
}

function writePref(k: string, v: string): void {
  try {
    window.localStorage.setItem(PREF(k), v);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

function subscribePref(cb: () => void): () => void {
  window.addEventListener(PREF_EVENT, cb);
  return () => window.removeEventListener(PREF_EVENT, cb);
}

export type LocalModelStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'unsupported';

export type LocalModel = {
  spec: ModelSpec;
  choices: ModelSpec[];
  setKey: (key: string) => void;
  device: DeviceInfo | null;
  plan: DevicePlan | null;
  status: LocalModelStatus;
  /** Bytes loaded / total while downloading. */
  progress: { loaded: number; total: number } | null;
  error: string | null;
  download: () => void;
  cancelDownload: () => void;
  /** Call when a run reports the model missing (storage was cleared). */
  markMissing: () => void;
};

/**
 * One on-device model choice for a tool: which model, where it would run,
 * whether it is downloaded, and the user-initiated download.
 */
export function useLocalModel(task: ModelTask, defaultKey: string, prefKey: string): LocalModel {
  const choices = modelsFor(task);
  const saved = useSyncExternalStore(
    subscribePref,
    () => readPref(prefKey),
    () => '',
  );
  const key = saved && getModel(saved)?.task === task ? saved : defaultKey;
  const spec = getModel(key) ?? (choices[0] as ModelSpec);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [checked, setChecked] = useState<{ id: string; ok: boolean } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [recheck, setRecheck] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    detectDevice().then((d) => live && setDevice(d));
    return () => {
      live = false;
    };
  }, []);

  const plan = device ? planDevice(spec, device) : null;
  const runOn = plan?.device ?? null;
  const id = `${spec.key}@${runOn ?? 'none'}`;

  useEffect(() => onModelsChanged(() => setRecheck((n) => n + 1)), []);

  useEffect(() => {
    if (!runOn) return;
    let live = true;
    const target = getModel(spec.key);
    if (!target) return;
    (isMarkedDownloaded(target, runOn) ? hasStoredFiles(target) : Promise.resolve(false)).then(
      (ok) => live && setChecked({ id: `${target.key}@${runOn}`, ok }),
      () => live && setChecked({ id: `${target.key}@${runOn}`, ok: false }),
    );
    return () => {
      live = false;
    };
  }, [spec.key, runOn, recheck]);

  const status: LocalModelStatus = !plan
    ? 'checking'
    : plan.device === null
      ? 'unsupported'
      : downloading === id
        ? 'downloading'
        : checked?.id === id
          ? checked.ok
            ? 'ready'
            : 'missing'
          : 'checking';

  const setKey = (k: string) => {
    ctrl.current?.abort();
    writePref(prefKey, k);
  };

  const download = () => {
    if (!plan || plan.device === null) return;
    const c = new AbortController();
    ctrl.current = c;
    const startedFor = id;
    setDownloading(startedFor);
    setError(null);
    setProgress({ loaded: 0, total: plan.bytes });
    localAi
      .ensure(spec, {
        device: plan.device,
        allowDownload: true,
        signal: c.signal,
        onDownload: (loaded, total) => setProgress({ loaded, total: Math.max(total, loaded) }),
      })
      .then(
        () => {
          setChecked({ id: startedFor, ok: true });
          setDownloading(null);
          setProgress(null);
        },
        (err: unknown) => {
          setDownloading(null);
          setProgress(null);
          setChecked({ id: startedFor, ok: false });
          if (!isAbortError(err)) {
            setError({
              id: startedFor,
              text:
                err instanceof Error
                  ? `The model could not be downloaded or started: ${err.message}`
                  : 'The model could not be downloaded.',
            });
          }
        },
      );
  };

  return {
    spec,
    choices,
    setKey,
    device,
    plan,
    status,
    progress: status === 'downloading' ? progress : null,
    error: error?.id === id ? error.text : null,
    download,
    cancelDownload: () => ctrl.current?.abort(),
    markMissing: () => setChecked({ id, ok: false }),
  };
}
