// pdfLaTeX (TeX Live 2026, BusyTeX WebAssembly build) in a module worker.
// The engine and the TeX files are served from /vendor/latex (see
// scripts/latex/build-texmf.mjs); nothing is fetched from anywhere else and
// TeX's remote package lookup is switched off.
import { expose } from 'comlink';

type EmFS = {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
  analyzePath(path: string): { exists: boolean };
  readdir(path: string): string[];
  unlink(path: string): void;
  rmdir(path: string): void;
  isDir(mode: number): boolean;
  stat(path: string): { mode: number };
  chdir(path: string): void;
};
type EmModule = {
  FS: EmFS;
  ENV: Record<string, string>;
  HEAPU8: Uint8Array;
  callMain(args: string[]): number;
  _flush_streams?: () => void;
};
type Factory = (m: Record<string, unknown>) => Promise<EmModule>;

export type LatexFile = { path: string; data: Uint8Array | string };
export type LatexResult = { pdf: Uint8Array | null; log: string; exitCode: number; passes: number; ms: number };
export type LatexProgress = (stage: string, fraction: number) => void;

const BASE = '/vendor/latex';
const PROJECT = '/home/web_user/project';
const FMT = '/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt';
const HEADER = 2 ** 26;

let ready: Promise<{ M: EmModule; header: Uint8Array; files: number }> | null = null;
let output = '';

async function fetchWithProgress(url: string, onBytes: (n: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(new URL(url, self.location.origin).href);
  if (!res.ok || !res.body) throw new Error(`The LaTeX engine is not installed on this site (${url}: HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(n, total);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

function load(progress?: LatexProgress) {
  ready ??= (async () => {
    progress?.('Loading the TeX engine', 0.02);
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL(`${BASE}/busytex.mjs`, self.location.origin).href)) as {
      default: Factory;
    };
    let wasmBytes = 0;
    let packBytes = 0;
    const report = () => progress?.('Downloading the TeX engine and fonts (once)', 0.05 + 0.75 * Math.min(1, (wasmBytes + packBytes) / 46e6));
    const [wasm, pack] = await Promise.all([
      fetchWithProgress(`${BASE}/busytex.wasm`, (n) => {
        wasmBytes = n;
        report();
      }).then((b) => WebAssembly.compile(b)),
      fetchWithProgress(`${BASE}/texmf.pack`, (n) => {
        packBytes = n;
        report();
      }),
    ]);
    progress?.('Starting TeX', 0.85);
    const env = {
      TEXMFDIST: '/texlive/texmf-dist',
      TEXMFVAR: '/texlive/texmf-dist/texmf-var',
      TEXMFCACHE: '/texlive/texmf-dist/texmf-var',
      TEXMFCNF: '/texlive/texmf-dist/web2c',
      TEXMFLOG: '/tmp/texmf.log',
      TEXLIVE_REMOTE_ENDPOINT: '',
    };
    const config: Record<string, unknown> = {
      thisProgram: '/bin/busytex',
      noInitialRun: true,
      print: (t: string) => (output += `${t}\n`),
      printErr: (t: string) => (output += `${t}\n`),
      instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
        void WebAssembly.instantiate(wasm, imports).then(done);
        return {};
      },
      // MODULARIZE builds use this object as the Module, so ENV appears on it before main runs.
      preRun: [() => Object.assign((config as unknown as EmModule).ENV, env)],
    };
    const M = await mod.default(config);
    // The pack: u32 index length, JSON [[path, offset, length]…], then the bytes.
    const view = new DataView(pack);
    const indexLength = view.getUint32(0, true);
    const index = JSON.parse(new TextDecoder().decode(new Uint8Array(pack, 4, indexLength))) as [string, number, number][];
    const base = 4 + indexLength;
    const made = new Set<string>();
    for (const [path, offset, length] of index) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (!made.has(dir)) {
        M.FS.mkdirTree(dir);
        made.add(dir);
      }
      M.FS.writeFile(path, new Uint8Array(pack, base + offset, length));
    }
    M.FS.mkdirTree('/bin');
    M.FS.writeFile('/bin/busytex', '');
    M.FS.mkdirTree('/tmp');
    M.FS.mkdirTree(PROJECT);
    const header = M.HEAPU8.slice(0, HEADER);
    return { M, header, files: index.length };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

function clearDir(FS: EmFS, dir: string) {
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const p = `${dir}/${name}`;
    if (FS.isDir(FS.stat(p).mode)) {
      clearDir(FS, p);
      FS.rmdir(p);
    } else FS.unlink(p);
  }
}

const api = {
  async warm(progress?: LatexProgress): Promise<{ files: number }> {
    const { files } = await load(progress);
    return { files };
  },

  async compile(files: LatexFile[], main: string, progress?: LatexProgress): Promise<LatexResult> {
    const t0 = performance.now();
    const { M, header } = await load(progress);
    const { FS } = M;
    clearDir(FS, PROJECT);
    for (const f of files) {
      const safe = f.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/(^|\/)\.\.(?=\/|$)/g, '');
      if (!safe) continue;
      const full = `${PROJECT}/${safe}`;
      FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      FS.writeFile(full, f.data);
    }
    const dir = main.includes('/') ? `${PROJECT}/${main.slice(0, main.lastIndexOf('/'))}` : PROJECT;
    const name = main.slice(main.lastIndexOf('/') + 1);
    const stem = name.replace(/\.tex$/i, '');
    FS.chdir(dir);
    let exitCode = 0;
    let log = '';
    let passes = 0;
    // Up to two passes: the second only when LaTeX asks (labels, outlines).
    for (let pass = 0; pass < 2; pass++) {
      progress?.(pass === 0 ? 'Typesetting' : 'Typesetting again (references)', 0.9);
      output = '';
      M.HEAPU8.fill(0);
      M.HEAPU8.set(header);
      exitCode = M.callMain(['pdflatex', '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--file-line-error', '--fmt', FMT, name]);
      M._flush_streams?.();
      passes++;
      log = FS.analyzePath(`${stem}.log`).exists ? new TextDecoder('latin1').decode(FS.readFile(`${stem}.log`)) : output;
      if (exitCode !== 0 || !/Rerun to get|Label\(s\) may have changed|rerunfilecheck/.test(log)) break;
    }
    const pdfPath = `${stem}.pdf`;
    const pdf = exitCode === 0 && FS.analyzePath(pdfPath).exists ? FS.readFile(pdfPath).slice() : null;
    return { pdf, log, exitCode, passes, ms: Math.round(performance.now() - t0) };
  },
};

export type LatexWorkerApi = typeof api;

expose(api);
