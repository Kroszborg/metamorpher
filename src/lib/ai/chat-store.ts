/**
 * Chat history per document set, in this browser's IndexedDB. Stores the
 * questions, the answers and which pages were cited — not the documents.
 * Keyed by a fingerprint of the files, so re-adding the same PDF brings its
 * conversation back. "Clear" deletes it.
 *
 * For a signed-in user who switched chat sync on (/account), conversations are
 * also kept on their account so they appear on other devices (same
 * questions, answers and citations; never the document). See lib/account/chat-sync.
 */
import { deleteRemoteChat, pullChat, pushChat } from '@/lib/account/chat-sync';

export type StoredSource = { n: number; docName: string; unit: 'page' | 'section'; page: number };
export type StoredTurn = {
  question: string;
  answer: string;
  sources: StoredSource[];
  via: string;
  at: number;
};

const DB = 'metamorpher-ai-chats';
const STORE = 'chats';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

async function loadLocal(key: string): Promise<StoredTurn[]> {
  try {
    const v = await tx<StoredTurn[] | undefined>('readonly', (s) => s.get(key) as IDBRequest<StoredTurn[] | undefined>);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function saveLocal(key: string, turns: StoredTurn[]): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(turns, key));
  } catch {
    // Storage blocked or full: the chat stays in memory.
  }
}

export async function loadChat(key: string): Promise<StoredTurn[]> {
  const local = await loadLocal(key);
  if (local.length) return local;
  // Not on this device: a synced copy from the account, if there is one.
  const remote = await pullChat(key).catch(() => null);
  if (!remote?.length) return [];
  await saveLocal(key, remote);
  return remote;
}

export async function saveChat(key: string, turns: StoredTurn[], title?: string): Promise<void> {
  await saveLocal(key, turns);
  if (title) void pushChat(key, title, turns).catch(() => undefined);
}

export async function clearChat(key: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    // ignore
  }
  void deleteRemoteChat(key).catch(() => undefined);
}

/** SHA-256 over name, size and the first and last 256 KB: stable for the same file, cheap for large ones. */
export async function fingerprint(files: readonly File[]): Promise<string> {
  const parts: BufferSource[] = [];
  const enc = new TextEncoder();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    parts.push(enc.encode(`${f.name}|${f.size}|`));
    parts.push(new Uint8Array(await f.slice(0, 262_144).arrayBuffer()));
    if (f.size > 262_144) parts.push(new Uint8Array(await f.slice(-262_144).arrayBuffer()));
  }
  const total = parts.reduce((n, p) => n + (p as Uint8Array).byteLength, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(p as Uint8Array, at);
    at += (p as Uint8Array).byteLength;
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}
