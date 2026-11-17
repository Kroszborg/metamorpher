'use client';

import { useCallback, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { parsePageRanges, rangesToIndices } from '@/components/pdf-pages';
import { PageRangeField, SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, type OutputFile, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { analyse, evidence, inkBand, OCR_LANGUAGES, OcrDocument, ocrDownloadBytes, ocrEngine, parsePgm, rotateGray, toPageLines, toPgm, unrotateResult } from '@/engines/ocr';
import { abortError } from '@/engines/worker-host';
import { baseName, extensionOf, formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import { imageForOcr } from './image-input';

type Output = 'pdf' | 'txt' | 'both';
type Report = { notes: ResultNote[]; preview: string };
type Options = {
  langs: string[];
  pages: string;
  output: Output;
  skipText: boolean;
  /** Turn pages that are sideways or upside down, and straighten skewed scans for recognition. */
  straighten: boolean;
  password: string;
  onReport: (id: string, report: Report) => void;
};

/** Pages that already carry at least this many visible characters count as having text. */
const HAS_TEXT = 30;
const OCR_DPI = 300;
const TEXT_TYPE = 'text/plain;charset=utf-8';
const PREVIEW_CHARS = 6000;

/**
 * Which way a page must turn (clockwise, 0/90/180/270) to read upright: the
 * direction of its text lines from their projection, then a quick
 * recognition of the inkiest band each way round to tell up from down.
 */
async function uprightTurn(doc: OcrDocument, index: number, langs: string[], signal: AbortSignal): Promise<number> {
  const probe = await doc.render(index, 150);
  const gray = parsePgm(probe.image);
  const layout = analyse(gray);
  if (layout.ink < 0.002 || layout.score < 1.4) return 0;
  const candidates = layout.vertical ? [90, 270] : [0, 180];
  let best = 0;
  let bestScore = -1;
  for (const turn of candidates) {
    const band = inkBand(rotateGray(gray, turn), 0.3);
    const result = await ocrEngine.recognize(toPgm(band), { langs, dpi: 150, signal });
    const score = evidence(result);
    if (score > bestScore) {
      bestScore = score;
      best = turn;
    }
  }
  return bestScore >= 8 ? best : 0;
}

const isPdf = (file: File) => file.type === 'application/pdf' || extensionOf(file.name) === 'pdf';

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const pdfInput = isPdf(file);
  const doc = pdfInput
    ? await OcrDocument.fromPdf(file, { password: o.password || undefined, signal: ctx.signal })
    : await OcrDocument.fromImages([await imageForOcr(file)], { signal: ctx.signal });
  try {
    const total = doc.pageCount;
    let selected = Array.from({ length: total }, (_, i) => i);
    if (pdfInput && o.pages.trim()) {
      const parsed = parsePageRanges(o.pages, total);
      if (parsed.error) throw new Error(parsed.error);
      selected = [...new Set(rangesToIndices(parsed.ranges))].sort((a, b) => a - b);
    }
    const texts = new Map<number, string>();
    let recognised = 0;
    let skipped = 0;
    let empty = 0;
    let words = 0;
    let confidence = 0;
    let turned = 0;
    let straightened = 0;
    let maxSkew = 0;
    for (const [k, index] of selected.entries()) {
      if (ctx.signal.aborted) throw abortError();
      const base = k / selected.length;
      const span = 1 / selected.length;
      const label = total > 1 ? `Page ${index + 1} of ${total}` : 'Image';
      ctx.onProgress(base, label);
      if (pdfInput && o.skipText) {
        const info = await doc.info(index);
        if (info.textChars >= HAS_TEXT) {
          texts.set(index, info.text);
          skipped += 1;
          continue;
        }
      }
      if (o.straighten) {
        ctx.onProgress(base, `${label}: finding which way up`);
        const turn = await uprightTurn(doc, index, o.langs, ctx.signal);
        if (turn) {
          await doc.rotate(index, turn);
          turned += 1;
        }
      }
      const render = await doc.render(index, OCR_DPI);
      // A skewed scan is straightened for recognition only; the page itself is not changed.
      let image = render.image;
      let skew = 0;
      if (o.straighten) {
        const gray = parsePgm(render.image);
        const layout = analyse(gray);
        if (!layout.vertical && Math.abs(layout.skew) >= 0.3 && Math.abs(layout.skew) <= 15 && layout.score >= 1.4) {
          skew = layout.skew;
          image = toPgm(rotateGray(gray, -skew));
          straightened += 1;
          maxSkew = Math.max(maxSkew, Math.abs(skew));
        }
      }
      let result = await ocrEngine.recognize(image, {
        langs: o.langs,
        dpi: (render.width / render.pageWidth) * 72,
        signal: ctx.signal,
        onProgress: (f, note) => ctx.onProgress(base + span * Math.min(1, f) * 0.95, `${label}: ${note.toLowerCase()}`),
      });
      if (skew) result = unrotateResult(result, -skew, render.width, render.height);
      const lines = toPageLines(result, render.pageWidth, render.pageHeight);
      const count = lines.reduce((n, l) => n + l.words.length, 0);
      texts.set(index, result.text);
      recognised += 1;
      if (count === 0) empty += 1;
      words += count;
      confidence += result.confidence * count;
      if (o.output !== 'txt' && count > 0) await doc.addTextLayer(index, lines);
    }

    const base = baseName(file.name);
    const outputs: OutputFile[] = [];
    if (o.output !== 'txt') {
      ctx.onProgress(0.98, 'Writing the PDF');
      outputs.push({ name: `${base}-ocr.pdf`, blob: await doc.save() });
    }
    const joined = selected
      .map((i) => (selected.length > 1 ? `=== Page ${i + 1} ===\n\n${texts.get(i) ?? ''}` : (texts.get(i) ?? '')))
      .join('\n\n');
    if (o.output !== 'pdf') outputs.push({ name: `${base}.txt`, blob: new Blob([joined], { type: TEXT_TYPE }) });

    const notes: ResultNote[] = [];
    const mean = words ? confidence / words : 0;
    if (recognised > 0) {
      notes.push({
        kind: words > 0 ? 'ok' : 'warn',
        text:
          words > 0
            ? `Recognised ${recognised} ${recognised === 1 ? 'page' : 'pages'}: ${words.toLocaleString()} words, average confidence ${Math.round(mean)}%.${
                o.output !== 'txt' ? ' The text is an invisible layer over the original page, so you can search, select and copy it.' : ''
              }`
            : 'No text was found. Check the language, or whether the image holds text at all.',
      });
    }
    if (words > 0 && mean < 60) {
      notes.push({ kind: 'warn', text: 'Low confidence: the scan may be blurred, skewed or too small, or the language may be wrong.' });
    }
    if (empty > 0 && words > 0) {
      notes.push({ kind: 'info', text: `${empty} ${empty === 1 ? 'page has' : 'pages have'} no recognisable text.` });
    }
    if (turned > 0) {
      notes.push({ kind: 'info', text: `${turned} ${turned === 1 ? 'page was' : 'pages were'} sideways or upside down and ${turned === 1 ? 'is' : 'are'} now turned upright${o.output === 'txt' ? '' : ' in the PDF'}.` });
    }
    if (straightened > 0) {
      notes.push({ kind: 'info', text: `${straightened} skewed ${straightened === 1 ? 'page was' : 'pages were'} straightened for recognition (up to ${maxSkew.toFixed(1)}°); the page images are left as they are.` });
    }
    if (skipped > 0) {
      notes.push({
        kind: 'info',
        text: `${skipped} ${skipped === 1 ? 'page already has' : 'pages already have'} text and ${skipped === 1 ? 'was' : 'were'} left as ${skipped === 1 ? 'it is' : 'they are'}.`,
      });
    }
    if (pdfInput && o.password && o.output !== 'txt') {
      notes.push({ kind: 'info', text: 'The PDF keeps its password protection; open it with the same password.' });
    }
    o.onReport(input.id, { notes, preview: joined.slice(0, PREVIEW_CHARS) });
    return outputs;
  } finally {
    doc.close();
  }
});

function LanguagePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Languages">
      {OCR_LANGUAGES.map((l) => {
        const on = value.includes(l.code);
        return (
          <button
            key={l.code}
            type="button"
            aria-pressed={on}
            data-lang={l.code}
            title={`${l.label}: ${formatBytes(l.bytes)} model, downloaded once`}
            onClick={() => {
              if (on && value.length === 1) return;
              onChange(on ? value.filter((c) => c !== l.code) : [...value, l.code]);
            }}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              on ? 'border-primary bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

export default function OcrPdf({ tool }: ToolProps) {
  const [langs, setLangs] = useState<string[]>(['eng']);
  const [pages, setPages] = useState('');
  const [output, setOutput] = useState<Output>('pdf');
  const [skipText, setSkipText] = useState(true);
  const [straighten, setStraighten] = useState(true);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(
    () => ({ langs, pages, output, skipText, straighten, password, onReport }),
    [langs, pages, output, skipText, straighten, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const first = wb.results.find((r) => r.name.endsWith('.txt')) ?? wb.results[0];
  const preview = first?.sourceId ? reports[first.sourceId]?.preview : undefined;
  const hasPdf = wb.files.some((f) => isPdf(f.file));

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Recognise text"
      optionsPanel={
        <>
          <OptionField
            label="Languages"
            hint="Pick every language the document uses. More languages are slower and less accurate, so choose only those."
          >
            <LanguagePicker value={langs} onChange={setLangs} />
          </OptionField>
          <OptionField label="Output">
            <Segmented<Output>
              label="Output"
              value={output}
              options={[
                { value: 'pdf', label: 'Searchable PDF' },
                { value: 'txt', label: 'Text' },
                { value: 'both', label: 'Both' },
              ]}
              onChange={setOutput}
            />
          </OptionField>
          <SwitchRow
            id="ocr-straighten"
            label="Turn and straighten pages"
            hint="Pages scanned sideways or upside down are turned upright; skewed scans are straightened for recognition (the images are not changed)."
            checked={straighten}
            onChange={setStraighten}
          />
          {hasPdf ? (
            <>
              <PageRangeField id="ocr-pages" value={pages} onChange={setPages} hint="For example 1-3, 7, 10-. Leave empty to recognise every page. Other pages are kept as they are." />
              <SwitchRow
                id="ocr-skip"
                label="Skip pages that already have text"
                hint="Off recognises every page, adding a second text layer where one exists."
                checked={skipText}
                onChange={setSkipText}
              />
              <OptionField label="Password" htmlFor="ocr-password" hint="Only for files that need a password to open.">
                <PasswordInput id="ocr-password" value={password} onChange={setPassword} placeholder="Not protected" />
              </OptionField>
            </>
          ) : null}
          <EngineNote bytes={ocrDownloadBytes(langs) + MUPDF_DOWNLOAD_BYTES} name="text recognition engine and language data" />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="ocr.zip"
        notesFor={(r) =>
          r.sourceId && wb.results.find((x) => x.sourceId === r.sourceId) === r ? (reports[r.sourceId]?.notes ?? []) : []
        }
      />
      {preview ? (
        <SectionCard title="Recognised text" description={first?.name}>
          <pre data-report="text-preview" className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[0.7rem]/relaxed text-muted-foreground">
            {preview}
          </pre>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
