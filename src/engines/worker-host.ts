import { type Remote, wrap } from 'comlink';

/** The error a job rejects with when its AbortSignal fires. Check with `isAbortError`. */
export function abortError(): DOMException {
  return new DOMException('The operation was cancelled.', 'AbortError');
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * A lazily created module worker behind a typed Comlink proxy.
 *
 * The worker starts on the first `call`, stays alive for later calls, and is
 * terminated when a call's signal aborts (the next call starts a fresh one) or
 * when it crashes. `factory` must contain the literal
 * `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
 * so the bundler can find and compile the worker.
 */
export class WorkerHost<Api> {
  #factory: () => Worker;
  #worker: Worker | null = null;
  #remote: Remote<Api> | null = null;
  #pending = new Set<(err: unknown) => void>();

  constructor(factory: () => Worker) {
    this.#factory = factory;
  }

  #start(): Remote<Api> {
    if (this.#remote) return this.#remote;
    const worker = this.#factory();
    worker.addEventListener('error', (event) => {
      this.terminate(new Error(event.message || 'The worker stopped unexpectedly.'));
    });
    this.#worker = worker;
    this.#remote = wrap<Api>(worker);
    return this.#remote;
  }

  /** Runs `fn` against the worker API; rejects with an AbortError and kills the worker on abort. */
  call<R>(fn: (api: Remote<Api>) => Promise<R>, signal?: AbortSignal): Promise<R> {
    if (signal?.aborted) return Promise.reject(abortError());
    const api = this.#start();
    return new Promise<R>((resolve, reject) => {
      const settle = () => {
        this.#pending.delete(reject);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        settle();
        this.terminate();
        reject(abortError());
      };
      this.#pending.add(reject);
      signal?.addEventListener('abort', onAbort, { once: true });
      fn(api).then(
        (value) => {
          settle();
          resolve(value);
        },
        (err: unknown) => {
          settle();
          reject(err);
        },
      );
    });
  }

  /** Stops the worker immediately and rejects calls still in flight. Safe to call at any time. */
  terminate(reason: unknown = abortError()): void {
    const pending = [...this.#pending];
    this.#pending.clear();
    for (const reject of pending) reject(reason);
    this.#worker?.terminate();
    this.#remote = null;
    this.#worker = null;
  }
}
