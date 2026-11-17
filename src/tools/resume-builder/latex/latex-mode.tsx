'use client';

import { Alert02Icon, Download04Icon, FileImportIcon, Loading03Icon, PlayIcon, StopIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/kit/section-card';
import { SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { isAbortError } from '@/engines';
import { downloadBlob, formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { Resume } from '../model';
import { CodeEditor, type CodeEditorHandle, type EditorDiagnostic } from './code-editor';
import { LATEX_DOWNLOAD_BYTES, type LatexIssue, latexEngine, parseLog } from './engine';
import { PdfPages } from './pdf-pages';
import { AVAILABLE_PACKAGES, LATEX_TEMPLATES, type LatexTemplateId } from './templates';

const SOURCE_KEY = 'metamorpher:resume-latex';
const TEXT_EXT = /\.(tex|cls|sty|bib|bst|txt|clo|def|cfg)$/i;
const ACCEPT = '.tex,.cls,.sty,.bib,.bst,.clo,.def,.cfg,.png,.jpg,.jpeg,.pdf';

type ProjectFile = { name: string; data: string | Uint8Array };
type Status = { kind: 'idle' } | { kind: 'running'; stage: string; fraction: number } | { kind: 'done'; ms: number; passes: number; ok: boolean };

function loadSource(): string | null {
  try {
    return localStorage.getItem(SOURCE_KEY);
  } catch {
    return null;
  }
}

export function LatexMode({ resume }: { resume: Resume }) {
  const [templateId, setTemplateId] = useState<LatexTemplateId>('classic');
  const [main, setMain] = useState('main.tex');
  // LaTeX mode only renders in the browser (after the user opens it), so storage can be read here.
  const [files, setFiles] = useState<ProjectFile[]>(() => [{ name: 'main.tex', data: loadSource() ?? LATEX_TEMPLATES[0]!.build(resume) }]);
  const [active, setActive] = useState('main.tex');
  const [auto, setAuto] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [issues, setIssues] = useState<LatexIssue[]>([]);
  const [log, setLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const editor = useRef<CodeEditorHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const latest = useRef({ files, main });
  useEffect(() => {
    latest.current = { files, main };
  });
  const [rerun, setRerun] = useState(0);
  const upload = useRef<HTMLInputElement>(null);

  const mainText = useMemo(() => {
    const f = files.find((x) => x.name === main);
    return typeof f?.data === 'string' ? f.data : '';
  }, [files, main]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (mainText) localStorage.setItem(SOURCE_KEY, mainText);
      } catch {
        // Storage full or blocked.
      }
    }, 600);
    return () => clearTimeout(t);
  }, [mainText]);

  async function compile() {
    if (abort.current) {
      pending.current = true;
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const { files: list, main: entry } = latest.current;
    setStatus({ kind: 'running', stage: 'Starting', fraction: 0 });
    try {
      const res = await latexEngine.compile(
        list.map((f) => ({ path: f.name, data: f.data })),
        entry,
        { signal: controller.signal, onProgress: (stage, fraction) => setStatus({ kind: 'running', stage, fraction }) },
      );
      const found = parseLog(res.log, entry);
      setIssues(found);
      setLog(res.log);
      if (res.pdf) setPdf(new Blob([new Uint8Array(res.pdf)], { type: 'application/pdf' }));
      setStatus({ kind: 'done', ms: res.ms, passes: res.passes, ok: !!res.pdf });
      if (!res.pdf && !found.some((i) => i.kind === 'error')) {
        setIssues([{ kind: 'error', line: null, file: entry, message: 'TeX stopped without a PDF. Open the full log for details.' }]);
      }
    } catch (err) {
      if (isAbortError(err)) {
        setStatus({ kind: 'idle' });
        toast.info('Compilation cancelled. The engine restarts on the next run.');
      } else {
        setStatus({ kind: 'idle' });
        setIssues([{ kind: 'error', line: null, file: null, message: err instanceof Error ? err.message : 'The TeX engine failed.' }]);
      }
    } finally {
      abort.current = null;
      if (pending.current) {
        pending.current = false;
        setRerun((n) => n + 1);
      }
    }
  }

  const compileLater = useEffectEvent(() => void compile());
  useEffect(() => {
    if (rerun) compileLater();
  }, [rerun]);

  // Live preview: compile a moment after typing stops (never more than one run at a time).
  useEffect(() => {
    if (!auto || !mainText) return;
    const t = setTimeout(() => compileLater(), 1200);
    return () => clearTimeout(t);
  }, [auto, mainText, files]);

  useEffect(() => () => abort.current?.abort(), []);

  const setText = (name: string, text: string) => setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, data: text } : f)));

  function replaceMain(text: string) {
    setFiles((fs) => fs.map((f) => (f.name === main ? { ...f, data: text } : f)));
    setActive(main);
  }

  async function addFiles(fileList: FileList | null) {
    // Copy first: the input is cleared right after this call, which empties a live FileList.
    const list = fileList ? [...fileList] : [];
    if (!list.length) return;
    const added: ProjectFile[] = [];
    let newMain: string | null = null;
    for (const f of list) {
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 20 MB.`);
        continue;
      }
      if (TEXT_EXT.test(f.name)) {
        const text = await f.text();
        added.push({ name: f.name, data: text });
        if (/\.tex$/i.test(f.name) && /\\documentclass/.test(text)) newMain = f.name;
      } else added.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
    setFiles((fs) => {
      const names = new Set(added.map((a) => a.name));
      let next = [...fs.filter((f) => !names.has(f.name)), ...added];
      // A new main document replaces the empty starter.
      if (newMain && newMain !== 'main.tex') next = next.filter((f) => f.name !== 'main.tex' || f.name === newMain);
      return next;
    });
    if (newMain) {
      setMain(newMain);
      setActive(newMain);
    }
    toast.success(`Added ${added.map((a) => a.name).join(', ')}.`);
  }

  const diagnostics: EditorDiagnostic[] = issues
    .filter((i) => i.line && (i.file === active || (!i.file && active === main)))
    .map((i) => ({ line: i.line as number, severity: i.kind, message: i.message }));
  const errors = issues.filter((i) => i.kind === 'error');
  const warnings = issues.filter((i) => i.kind === 'warning');
  const activeFile = files.find((f) => f.name === active) ?? files[0];
  const running = status.kind === 'running';

  return (
    <div className="flex flex-col gap-4" data-latex-mode>
      <SectionCard
        title="LaTeX"
        description="Real pdfLaTeX (TeX Live 2026) compiled to WebAssembly, running in this tab. Nothing is uploaded."
        contentClassName="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[0.7rem] font-medium text-muted-foreground">
            Template
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.currentTarget.value as LatexTemplateId)}
              className="h-7 rounded-md border border-input bg-input/20 px-1.5 text-xs text-foreground dark:bg-input/30"
              aria-label="LaTeX template"
            >
              {LATEX_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Generate LaTeX for this template from the form (replaces the editor text)"
            onClick={() => {
              const t = LATEX_TEMPLATES.find((x) => x.id === templateId) ?? LATEX_TEMPLATES[0]!;
              if (mainText.trim() && !window.confirm('Replace the LaTeX in the editor with the form contents in this template?')) return;
              replaceMain(t.build(resume));
            }}
          >
            Form → LaTeX
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => upload.current?.click()}>
            <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
            Upload .tex / .cls / .sty / images
          </Button>
          <input
            ref={upload}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload LaTeX files"
            onChange={(e) => {
              void addFiles(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => downloadBlob(new Blob([mainText], { type: 'application/x-tex' }), main)}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            .tex
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!pdf} onClick={() => pdf && downloadBlob(pdf, main.replace(/\.tex$/i, '.pdf'))}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            .pdf
          </Button>
        </div>
        <p className="text-[0.7rem]/relaxed text-muted-foreground">{LATEX_TEMPLATES.find((t) => t.id === templateId)?.hint}</p>
      </SectionCard>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5" role="tablist" aria-label="Project files">
            {files.map((f) => (
              <button
                key={f.name}
                type="button"
                role="tab"
                aria-selected={f.name === active}
                disabled={typeof f.data !== 'string'}
                onClick={() => setActive(f.name)}
                className={cn(
                  'rounded-md px-2 py-0.5 font-mono text-[0.7rem]',
                  f.name === active ? 'bg-muted text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                  typeof f.data !== 'string' && 'cursor-default opacity-70',
                )}
                title={typeof f.data === 'string' ? f.name : `${f.name} (${formatBytes(f.data.length)}, binary)`}
              >
                {f.name}
                {f.name === main ? ' ★' : ''}
              </button>
            ))}
            <span className="ml-auto text-[0.65rem] text-muted-foreground">Ctrl+F search · Ctrl+Space complete</span>
          </div>
          <div className="h-[34rem] min-h-0">
            {activeFile && typeof activeFile.data === 'string' ? (
              <CodeEditor
                key={activeFile.name}
                ref={editor}
                label={`LaTeX source: ${activeFile.name}`}
                value={activeFile.data}
                onChange={(v) => setText(activeFile.name, v)}
                diagnostics={diagnostics}
              />
            ) : null}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button type="button" size="sm" variant="outline" onClick={() => abort.current?.abort()}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                Cancel
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => void compile()}>
                <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                Compile
              </Button>
            )}
            <div className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite" data-latex-status>
              {status.kind === 'running' ? (
                <span className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-3.5 animate-spin" />
                  {status.stage}
                  {status.fraction > 0 && status.fraction < 0.9 ? ` ${Math.round(status.fraction * 100)}%` : ''}
                </span>
              ) : status.kind === 'done' ? (
                status.ok ? (
                  `Compiled in ${(status.ms / 1000).toFixed(1)} s (${status.passes} ${status.passes === 1 ? 'pass' : 'passes'})`
                ) : (
                  <span className="text-destructive">Compilation failed</span>
                )
              ) : (
                `First run downloads the engine (${formatBytes(LATEX_DOWNLOAD_BYTES)}) once.`
              )}
            </div>
            <div className="w-36">
              <SwitchRow id="latex-auto" label="Live preview" checked={auto} onChange={setAuto} />
            </div>
          </div>

          {issues.length ? (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto" data-latex-issues>
              {[...errors, ...warnings.slice(0, 20)].map((i, k) => (
                <li key={k}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[0.72rem]/relaxed hover:bg-muted',
                      i.kind === 'error' ? 'text-destructive' : 'text-warning',
                    )}
                    onClick={() => {
                      if (i.file && files.some((f) => f.name === i.file)) setActive(i.file);
                      if (i.line) setTimeout(() => editor.current?.goToLine(i.line as number), 50);
                    }}
                    data-issue={i.kind}
                  >
                    <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0">
                      {i.line ? <span className="font-mono">{i.file ?? main}:{i.line} </span> : null}
                      {i.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="max-h-[46rem] overflow-y-auto rounded-lg bg-muted/60 p-3">
            {pdf ? (
              <PdfPages pdf={pdf} />
            ) : (
              <p className="py-16 text-center text-xs text-muted-foreground">The PDF appears here.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog} disabled={!log}>
              {showLog ? 'Hide' : 'Show'} full log
            </Button>
          </div>
          {showLog ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 font-mono text-[0.65rem]/relaxed whitespace-pre-wrap" data-latex-log>
              {log}
            </pre>
          ) : null}
        </section>
      </div>

      <details className="rounded-xl border bg-card px-4 py-3 text-xs">
        <summary className="cursor-pointer font-medium">Packages and fonts available</summary>
        <p className="mt-2 text-muted-foreground">
          This is a trimmed TeX Live 2026 tree, so it stays a small download. pdfLaTeX only (no XeLaTeX/LuaLaTeX fonts, no shell
          escape, no BibTeX). Upload a .sty or .cls next to your document to use a package that is not listed; a package that is
          missing stops the run with a message naming it.
        </p>
        <p className="mt-2 font-mono text-[0.7rem]/relaxed">{AVAILABLE_PACKAGES.join(' · ')}</p>
      </details>
    </div>
  );
}
