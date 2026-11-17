/**
 * Downloaded on-device models: which are present, how big, and removal.
 * Models are stored in Cache Storage (`metamorpher-models`), keyed by their
 * huggingface.co URLs. A small marker in localStorage records which model and
 * device variant finished downloading, so tools can tell "ready" from "partial".
 */
import { getModel, MODELS, type Device, type ModelSpec } from './catalog';

export const MODEL_CACHE = 'metamorpher-models';
const MARKERS = 'metamorpher:models:v1';
const EVENT = 'metamorpher:models';
/** Older or default cache names that may also hold model files (Transformers.js, the service worker). */
const OTHER_CACHES = ['transformers-cache', 'cross-origin'];

type Markers = Record<string, { device: Device; at: number }>;

function readMarkers(): Markers {
  try {
    return JSON.parse(window.localStorage.getItem(MARKERS) ?? '{}') as Markers;
  } catch {
    return {};
  }
}

function writeMarkers(m: Markers): void {
  try {
    window.localStorage.setItem(MARKERS, JSON.stringify(m));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

const markerKey = (spec: ModelSpec, device: Device) => `${spec.key}@${device}`;

export function markDownloaded(spec: ModelSpec, device: Device): void {
  writeMarkers({ ...readMarkers(), [markerKey(spec, device)]: { device, at: Date.now() } });
}

export function isMarkedDownloaded(spec: ModelSpec, device: Device): boolean {
  return markerKey(spec, device) in readMarkers();
}

export function onModelsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

function repoOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'huggingface.co') return null;
    const m = /^\/([^/]+\/[^/]+)\/resolve\//.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export type StoredModel = {
  repo: string;
  spec?: ModelSpec;
  files: number;
  /** From Content-Length when the cached responses carry it, else the catalogue size. */
  bytes: number;
};

/** Every model with files in this browser's model storage. */
export async function storedModels(): Promise<StoredModel[]> {
  if (typeof caches === 'undefined') return [];
  const byRepo = new Map<string, StoredModel>();
  for (const name of [MODEL_CACHE, ...OTHER_CACHES]) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const repo = repoOf(req.url);
      if (!repo) continue;
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length') ?? 0);
      const entry = byRepo.get(repo) ?? { repo, spec: MODELS.find((m) => m.repo === repo), files: 0, bytes: 0 };
      entry.files += 1;
      entry.bytes += Number.isFinite(len) ? len : 0;
      byRepo.set(repo, entry);
    }
  }
  for (const e of byRepo.values()) {
    if (e.bytes === 0 && e.spec) e.bytes = Math.max(e.spec.bytes.wasm ?? 0, e.spec.bytes.webgpu ?? 0);
  }
  return [...byRepo.values()].sort((a, b) => b.bytes - a.bytes);
}

/** True when the model has files in storage (it may still be incomplete without a marker). */
export async function hasStoredFiles(spec: ModelSpec): Promise<boolean> {
  if (typeof caches === 'undefined' || !(await caches.has(MODEL_CACHE))) return false;
  const cache = await caches.open(MODEL_CACHE);
  return (await cache.keys()).some((r) => repoOf(r.url) === spec.repo);
}

/** Deletes one model's files and markers. */
export async function removeModel(repo: string): Promise<void> {
  if (typeof caches !== 'undefined') {
    for (const name of [MODEL_CACHE, ...OTHER_CACHES]) {
      if (!(await caches.has(name))) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) if (repoOf(req.url) === repo) await cache.delete(req);
    }
  }
  const markers = readMarkers();
  for (const k of Object.keys(markers)) {
    const spec = getModel(k.split('@')[0] ?? '');
    if (spec?.repo === repo) delete markers[k];
  }
  writeMarkers(markers);
}

/** Deletes every downloaded model. */
export async function removeAllModels(): Promise<void> {
  if (typeof caches !== 'undefined') {
    await caches.delete(MODEL_CACHE);
    await caches.delete('transformers-cache');
    if (await caches.has('cross-origin')) {
      const cache = await caches.open('cross-origin');
      for (const req of await cache.keys()) if (repoOf(req.url)) await cache.delete(req);
    }
  }
  writeMarkers({});
}
