import { proxy } from 'comlink';
import { WorkerHost } from '@/engines/worker-host';
import type { LatexFile, LatexProgress, LatexResult, LatexWorkerApi } from './latex.worker';

export type { LatexFile, LatexResult };

const host = new WorkerHost<LatexWorkerApi>(() => new Worker(new URL('./latex.worker.ts', import.meta.url), { type: 'module' }));

/** busytex.wasm + texmf.pack, downloaded once (then from the browser cache). */
export const LATEX_DOWNLOAD_BYTES = 46_000_000;

function withProgress<R>(fn: LatexProgress | undefined, call: (p: LatexProgress | undefined) => Promise<R>): Promise<R> {
  if (!fn) return call(undefined);
  let live = true;
  const p = proxy<LatexProgress>((stage, fraction) => {
    if (live) fn(stage, fraction);
  });
  return call(p).finally(() => {
    live = false;
  });
}

/** pdfLaTeX in a worker. Aborting terminates the worker (the next call starts it again). */
export const latexEngine = {
  warm(opts: { signal?: AbortSignal; onProgress?: LatexProgress } = {}): Promise<{ files: number }> {
    return withProgress(opts.onProgress, (p) => host.call((api) => api.warm(p), opts.signal));
  },
  compile(files: LatexFile[], main: string, opts: { signal?: AbortSignal; onProgress?: LatexProgress } = {}): Promise<LatexResult> {
    return withProgress(opts.onProgress, (p) => host.call((api) => api.compile(files, main, p), opts.signal));
  },
  terminate(): void {
    host.terminate();
  },
};

export type LatexIssue = { kind: 'error' | 'warning'; line: number | null; file: string | null; message: string; missing?: string };

/**
 * Errors and warnings from a TeX log (run with --file-line-error):
 * "./main.tex:12: Undefined control sequence." and "! LaTeX Error: File `x.sty' not found."
 */
export function parseLog(log: string, main = 'main.tex'): LatexIssue[] {
  const out: LatexIssue[] = [];
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    const fl = /^(?:\.\/)?([^:\s][^:]*\.(?:tex|cls|sty)):(\d+): (.*)$/.exec(l);
    const bang = /^! (.*)$/.exec(l);
    if (fl || bang) {
      let message = (fl ? fl[3] : bang?.[1]) ?? '';
      // TeX wraps long messages; the next lines up to "l.<n>" carry context.
      let line = fl ? Number(fl[2]) : null;
      let file = fl ? (fl[1] as string).replace(/^\.\//, '') : null;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const m = /^l\.(\d+) (.*)$/.exec(lines[j] as string);
        if (m) {
          line ??= Number(m[1]);
          const ctx = (m[2] as string).trim();
          if (ctx && !message.includes(ctx)) message += ` — near “${ctx.slice(-40)}”`;
          break;
        }
      }
      const missing = /File [`'‘]([^'’]+)['’] not found/.exec(message)?.[1];
      if (missing) message = `The package or file “${missing}” is not available in this browser TeX installation.`;
      file ??= main;
      if (!out.some((o) => o.message === message && o.line === line)) out.push({ kind: 'error', line, file, message, missing });
      continue;
    }
    const w = /^(?:LaTeX|Package \w+) Warning: (.*)$/.exec(l);
    if (w) {
      let message = w[1] as string;
      for (let j = i + 1; j < lines.length && /^\(\w+\)\s/.test(lines[j] as string); j++) message += ` ${(lines[j] as string).replace(/^\(\w+\)\s+/, '')}`;
      const at = /on input line (\d+)/.exec(message);
      out.push({ kind: 'warning', line: at ? Number(at[1]) : null, file: main, message });
    }
    if (/^Overfull \\hbox/.test(l)) {
      const at = /at lines? (\d+)/.exec(l);
      out.push({ kind: 'warning', line: at ? Number(at[1]) : null, file: main, message: l.trim() });
    }
  }
  // "Emergency stop" and "Fatal error occurred" only repeat the real error above them.
  const noise = /Emergency stop|Fatal error occurred|no output PDF file produced/;
  const real = out.filter((o) => !(o.kind === 'error' && noise.test(o.message)));
  return real.some((o) => o.kind === 'error') ? real : out;
}
