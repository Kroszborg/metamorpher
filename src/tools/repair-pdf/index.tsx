'use client';

import { useCallback, useMemo, useState } from 'react';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { isPasswordError, MUPDF_DOWNLOAD_BYTES, mupdfEngine, type RepairReport } from '@/engines/mupdf';
import { qpdfEngine } from '@/engines/qpdf';
import { isAbortError } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Report = { notes: ResultNote[]; messages: string[] };
type Options = { password: string; onReport: (id: string, r: Report) => void };

const STRATEGY: Record<RepairReport['strategy'], string> = {
  mupdf: 'Repaired with MuPDF',
  'mupdf-pages': 'Repaired with MuPDF, keeping the pages that could be read',
  qpdf: 'Recovered with qpdf, then rewritten with MuPDF',
  raster: 'Rebuilt from pictures of the pages',
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const password = o.password || undefined;
  const failures: string[] = [];
  let best: { blob: Blob; report: RepairReport } | null = null;

  // 1. MuPDF: rebuilds the xref, trims a truncated tail, rebuilds a lost page tree.
  try {
    best = await mupdfEngine.repair(file, {
      signal: ctx.signal,
      password,
      onProgress: (done, total) => ctx.onProgress((done / Math.max(1, total)) * 0.5, 'Reading pages with MuPDF'),
    });
  } catch (err) {
    if (isAbortError(err) || isPasswordError(err)) throw err;
    failures.push(message(err));
  }

  // 2. qpdf's own reconstruction, when MuPDF failed or lost pages; its output is checked by MuPDF again.
  if (!best || best.report.pagesFailed.length > 0) {
    ctx.onProgress(0.55, 'Trying qpdf');
    try {
      const q = await qpdfEngine.repair(file, { signal: ctx.signal, password });
      const again = await mupdfEngine.repair(q.blob, { signal: ctx.signal });
      if (!best || again.report.pagesRecovered > best.report.pagesRecovered) {
        best = {
          blob: again.blob,
          report: {
            ...again.report,
            strategy: 'qpdf',
            repaired: true,
            notes: ['qpdf reconstructed the file structure.', ...again.report.notes],
            messages: [...q.warnings, ...again.report.messages].slice(0, 12),
          },
        };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      failures.push(message(err));
    }
  }

  // 3. Last resort: pictures of whatever pages can still be drawn (text is lost).
  if (!best) {
    ctx.onProgress(0.75, 'Rendering the pages as pictures');
    try {
      best = await mupdfEngine.rasterize(file, { dpi: 150, quality: 85 }, { signal: ctx.signal, password });
    } catch (err) {
      if (isAbortError(err)) throw err;
      failures.push(message(err));
    }
  }

  if (!best) {
    throw new Error(
      `This file could not be recovered: no readable PDF content was found. It may not be a PDF, or too much of it is missing. (${failures[0] ?? 'unknown error'})`,
    );
  }

  const { report } = best;
  const notes: ResultNote[] = [];
  if (!report.repaired && report.pagesFailed.length === 0) {
    notes.push({ kind: 'ok', text: `No damage found. The file was rewritten cleanly (${report.pagesRecovered} ${report.pagesRecovered === 1 ? 'page' : 'pages'}).` });
  } else {
    notes.push({
      kind: report.strategy === 'raster' ? 'warn' : 'ok',
      text: `${STRATEGY[report.strategy]}: ${report.pagesRecovered} ${report.pagesRecovered === 1 ? 'page' : 'pages'} recovered.`,
    });
  }
  if (report.pagesFailed.length) {
    notes.push({
      kind: 'warn',
      text: `${report.pagesFailed.length === 1 ? 'Page' : 'Pages'} ${report.pagesFailed.map((p) => p + 1).join(', ')} could not be read and ${
        report.pagesFailed.length === 1 ? 'was' : 'were'
      } left out.`,
    });
  }
  for (const n of report.notes) notes.push({ kind: report.strategy === 'raster' ? 'warn' : 'info', text: n });
  o.onReport(input.id, { notes, messages: report.messages });
  ctx.onProgress(1);
  return { name: `${baseName(file.name)}-repaired.pdf`, blob: best.blob };
});

export default function RepairPdf({ tool }: ToolProps) {
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(() => ({ password, onReport }), [password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const withMessages = wb.results.filter((r) => r.sourceId && (reports[r.sourceId]?.messages.length ?? 0) > 0);

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Repair"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Rebuilds damaged and truncated PDFs: first with MuPDF, then with qpdf, and as a last resort by turning each
            readable page into a picture (the text then can no longer be selected).
          </p>
          <OptionField label="Password" htmlFor="rp-password" hint="Only for files that need a password to open.">
            <PasswordInput id="rp-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="repaired-pdfs.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
      {withMessages.length > 0 ? (
        <details className="rounded-xl border bg-card px-5 py-3 text-xs">
          <summary className="cursor-pointer font-medium">Technical details</summary>
          {withMessages.map((r) => (
            <div key={r.id} className="mt-3">
              <p className="font-medium">{r.name}</p>
              <ul className="mt-1 list-disc pl-4 font-mono text-[0.7rem]/relaxed text-muted-foreground">
                {(r.sourceId ? (reports[r.sourceId]?.messages ?? []) : []).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ) : null}
    </ToolFrame>
  );
}
