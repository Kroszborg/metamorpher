// qpdf (WebAssembly) in a module worker. The Emscripten build is CommonJS, so
// scripts/copy-runtime-assets.mjs writes an ES-module copy to
// public/vendor/qpdf/qpdf.mjs, which is imported from this origin at runtime
// (the bundler never sees it). A fresh instance runs every command: qpdf's
// main() is not meant to be re-entered, and the compiled wasm is cached.
import { expose } from 'comlink';

type QpdfInstance = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
};
type QpdfFactory = (opts: { locateFile: () => string; noInitialRun?: boolean }) => Promise<QpdfInstance>;

const vendor = (path: string) => new URL(`/vendor/qpdf/${path}`, self.location.origin).href;

let factory: Promise<QpdfFactory> | null = null;
function loadFactory(): Promise<QpdfFactory> {
  factory ??= (
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ vendor('qpdf.mjs')) as Promise<{ default: QpdfFactory }>
  ).then((m) => m.default);
  return factory;
}

export type QpdfRun = { code: number; output: string[]; files: Record<string, Blob> };

/**
 * Runs qpdf with `args`. `inputs` are written to the in-memory file system
 * first (args refer to them by path); `outputs` are read back afterwards when
 * they exist. qpdf prints through console.log/error, captured while it runs.
 */
async function run(args: string[], inputs: Record<string, Blob>, outputs: string[]): Promise<QpdfRun> {
  const create = await loadFactory();
  const output: string[] = [];
  const { log, error, warn } = console;
  const capture = (...parts: unknown[]) => output.push(parts.map(String).join(' '));
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  try {
    const q = await create({ locateFile: () => vendor('qpdf.wasm'), noInitialRun: true });
    for (const [path, blob] of Object.entries(inputs)) {
      q.FS.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    }
    let code: number;
    try {
      code = q.callMain(args);
    } catch (err) {
      // Emscripten throws an ExitStatus object for exit(); its status is the exit code.
      const status = (err as { status?: unknown }).status;
      if (typeof status === 'number') code = status;
      else throw err;
    }
    const files: Record<string, Blob> = {};
    for (const path of outputs) {
      try {
        files[path] = new Blob([q.FS.readFile(path) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      } catch {
        // not written
      }
    }
    return { code, output, files };
  } finally {
    console.log = log;
    console.error = error;
    console.warn = warn;
  }
}

const api = { run };

export type QpdfWorkerApi = typeof api;

expose(api);
