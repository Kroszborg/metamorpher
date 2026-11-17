// Hashes one file with one algorithm, reading it in 8 MB slices so files of
// any size use a few MB of memory. The tool runs one worker per algorithm so
// SHA-256, SHA-1 and MD5 proceed in parallel.
import { expose } from 'comlink';
import { ALGORITHMS, type Algorithm } from './hashes';

const CHUNK = 8 * 1024 * 1024;

async function hash(file: Blob, algorithm: Algorithm, onProgress?: (bytesDone: number) => void): Promise<string> {
  const spec = ALGORITHMS.find((a) => a.id === algorithm);
  if (!spec) throw new Error(`Unknown algorithm ${algorithm}.`);
  const hasher = spec.create();
  for (let at = 0; at < file.size; at += CHUNK) {
    const chunk = new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
    hasher.update(chunk);
    onProgress?.(Math.min(file.size, at + CHUNK));
  }
  return hasher.digest();
}

const api = { hash };

export type HashWorkerApi = typeof api;

expose(api);
