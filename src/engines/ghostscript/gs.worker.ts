// Ghostscript (WebAssembly, AGPL) in a module worker. The Emscripten glue is an
// ES module that locates gs.wasm itself, so it is served unbundled from
// public/vendor/ghostscript (scripts/copy-runtime-assets.mjs) and imported from
// this origin at runtime. Ghostscript's main() is not re-entrant, so every run
// gets a fresh instance; the compiled wasm module is cached and reused.
import { expose, transfer } from 'comlink';

type GsInstance = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
};
type GsFactory = (opts: {
  print: (line: string) => void;
  printErr: (line: string) => void;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => object;
}) => Promise<GsInstance>;

const vendor = (path: string) => new URL(`/vendor/ghostscript/${path}`, self.location.origin).href;

let factory: Promise<GsFactory> | null = null;
let wasm: Promise<WebAssembly.Module> | null = null;

function load(): { factory: Promise<GsFactory>; wasm: Promise<WebAssembly.Module> } {
  factory ??= (
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ vendor('gs.js')) as Promise<{ default: GsFactory }>
  ).then((m) => m.default);
  wasm ??= WebAssembly.compileStreaming(fetch(vendor('gs.wasm')));
  return { factory, wasm };
}

export type GsRun = { code: number; log: string[]; output: Uint8Array<ArrayBuffer> | null };

async function run(args: string[], input: Blob, inputName: string, outputName: string): Promise<GsRun> {
  const { factory: f, wasm: w } = load();
  const [create, module] = await Promise.all([f, w]);
  const log: string[] = [];
  const gs = await create({
    print: (line) => log.push(line),
    printErr: (line) => log.push(line),
    instantiateWasm(imports, done) {
      void WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
      return {};
    },
  });
  gs.FS.writeFile(inputName, new Uint8Array(await input.arrayBuffer()));
  let code: number;
  try {
    code = gs.callMain(args);
  } catch (err) {
    // Emscripten throws an ExitStatus object for exit(); its status is the exit code.
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') code = status;
    else throw err;
  }
  let output: Uint8Array<ArrayBuffer> | null = null;
  try {
    output = gs.FS.readFile(outputName).slice();
  } catch {
    output = null;
  }
  const result: GsRun = { code, log: log.slice(-40), output };
  return output ? transfer(result, [output.buffer]) : result;
}

const api = { run };

export type GsWorkerApi = typeof api;

expose(api);
