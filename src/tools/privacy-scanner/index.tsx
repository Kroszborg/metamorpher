'use client';

import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { isPasswordError, MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { type CleanOptions, PII_CATEGORIES, type PiiCategory, piiEngine, type PrivacyReport } from '@/engines/pii';
import { isAbortError } from '@/engines/worker-host';
import { baseName, formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';

type Options = { clean: CleanOptions; password: string; onReport: (id: string, notes: ResultNote[]) => void };

const LABEL = Object.fromEntries(PII_CATEGORIES.map((c) => [c.id, c.label])) as Record<PiiCategory, string>;

/** One line of the summary: what was found, in numbers, and whether cleaning can remove it. */
type Issue = { id: string; label: string; count: number; fix: keyof CleanOptions | null };

function issues(r: PrivacyReport): Issue[] {
  const meta = r.info.length + (r.xmp?.fields.length ?? 0) + r.thumbnails + (r.pieceInfo ? 1 : 0);
  return [
    { id: 'metadata', label: 'Metadata fields', count: meta, fix: 'metadata' },
    { id: 'attachments', label: 'Attached files', count: r.attachments.length, fix: 'attachments' },
    { id: 'javascript', label: 'Scripts and automatic actions', count: r.javascript.length + r.actions.length, fix: 'javascript' },
    { id: 'comments', label: 'Comments and markups', count: r.annotations.length, fix: 'comments' },
    { id: 'fields', label: 'Filled form fields', count: r.fields.filter((f) => f.value).length, fix: 'formValues' },
    { id: 'covered', label: 'Text hidden under dark boxes', count: r.covered.length, fix: 'covered' },
    { id: 'revisions', label: 'Earlier saved versions', count: r.revisions - 1, fix: 'metadata' },
    { id: 'layers', label: 'Hidden layers', count: r.layers.filter((l) => l.hidden).length, fix: 'hiddenLayers' },
    { id: 'image-meta', label: 'Metadata inside pictures', count: r.imageMeta.withMeta, fix: 'imageMetadata' },
    { id: 'file-id', label: 'File identifier', count: r.ids.length ? 1 : 0, fix: 'fileId' },
    { id: 'pii', label: 'Personal data in the text', count: r.pii.reduce((n, p) => n + p.count, 0), fix: null },
    { id: 'links', label: 'Links to websites', count: r.links.length, fix: null },
  ];
}

const job = perFile<Options>(async (input, o, ctx) => {
  if (!Object.values(o.clean).some(Boolean)) throw new Error('Choose at least one thing to remove.');
  ctx.onProgress(0.05, 'Cleaning');
  const password = o.password || undefined;
  const before = await piiEngine.privacy(input.file, { signal: ctx.signal, password });
  const { blob, removed, redactionPassed } = await piiEngine.clean(input.file, o.clean, { signal: ctx.signal, password });
  ctx.onProgress(0.7, 'Checking the result');
  const after = await piiEngine.privacy(blob, { signal: ctx.signal });
  const notes: ResultNote[] = [];
  if (removed.length) notes.push({ kind: 'info', text: `Removed: ${removed.join('; ')}.` });
  if (redactionPassed === false) {
    throw new Error('Verification failed: text under a dark box could still be extracted after redaction, so no file was produced.');
  }
  const a = issues(after);
  const fixed: string[] = [];
  const left: string[] = [];
  for (const b of issues(before)) {
    const now = a.find((x) => x.id === b.id)?.count ?? 0;
    if (b.count > 0 && now === 0) fixed.push(b.label.toLowerCase());
    else if (now > 0) left.push(`${b.label.toLowerCase()} (${now})`);
  }
  notes.push({
    kind: 'ok',
    text: `Verified by scanning the cleaned file again${fixed.length ? `: no ${fixed.join(', no ')} remain` : ''}.`,
  });
  if (left.length) notes.push({ kind: 'warn', text: `Still in the file: ${left.join(', ')}. These are left for you to judge, or need another tool.` });
  o.onReport(input.id, notes);
  return { name: `${baseName(input.file.name)}-clean.pdf`, blob };
});

function Finding({
  title,
  count,
  severity,
  summary,
  children,
}: {
  title: string;
  count: number;
  severity: 'risk' | 'note';
  summary: React.ReactNode;
  children?: React.ReactNode;
}) {
  const found = count > 0;
  return (
    <details className="group border-b last:border-b-0" data-finding={title} data-count={count} open={found && severity === 'risk'}>
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-5 py-3 hover:bg-muted/40">
        <HugeiconsIcon
          icon={!found ? CheckmarkCircle02Icon : severity === 'risk' ? Alert02Icon : InformationCircleIcon}
          strokeWidth={2}
          className={cn('mt-0.5 size-4 shrink-0', !found ? 'text-success' : severity === 'risk' ? 'text-warning' : 'text-muted-foreground')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {title} <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
          </p>
          <p className="text-xs/relaxed text-muted-foreground">{summary}</p>
        </div>
      </summary>
      {found && children ? <div className="px-5 pb-3 pl-12 text-xs/relaxed">{children}</div> : null}
    </details>
  );
}

function KeyValues({ rows }: { rows: { key: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="truncate font-mono text-muted-foreground" title={r.key}>
            {r.key}
          </dt>
          <dd className="break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const mask = (s: string) => (s.length <= 4 ? '••••' : `${s.slice(0, 2)}${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-2)}`);

function Report({ report }: { report: PrivacyReport }) {
  const r = report;
  const meta = [...r.info, ...(r.xmp?.fields ?? []).map((f) => ({ key: f.key, value: f.value }))];
  const piiTotal = r.pii.reduce((n, p) => n + p.count, 0);
  const hiddenLayers = r.layers.filter((l) => l.hidden);
  const filled = r.fields.filter((f) => f.value);
  const unembedded = r.fonts.filter((f) => !f.embedded);
  return (
    <SectionCard title="What this PDF reveals" description={`${r.pageCount} ${r.pageCount === 1 ? 'page' : 'pages'} scanned on this device`} contentClassName="p-0" data-report="privacy">
      <Finding
        title="Metadata"
        count={meta.length + r.thumbnails + (r.pieceInfo ? 1 : 0)}
        severity="risk"
        summary={
          meta.length
            ? `Authors, software and dates stored in the file${r.xmp ? ` (XMP packet of ${formatBytes(r.xmp.bytes)})` : ''}.`
            : 'No document properties or XMP metadata.'
        }
      >
        <KeyValues rows={meta} />
        {r.thumbnails ? <p className="mt-1.5">{r.thumbnails} embedded page thumbnails.</p> : null}
        {r.pieceInfo ? <p className="mt-1.5">Private application data (PieceInfo), e.g. editable artwork from Illustrator.</p> : null}
      </Finding>
      <Finding
        title="Earlier versions"
        count={r.revisions - 1}
        severity="risk"
        summary={
          r.revisions > 1
            ? `Saved ${r.revisions} times with incremental updates: deleted or changed content may still be recoverable from the file.`
            : 'Saved once; no earlier versions are kept inside.'
        }
      />
      <Finding
        title="Text hidden under dark boxes"
        count={r.covered.length}
        severity="risk"
        summary={
          !r.coverChecked
            ? 'Could not be checked.'
            : r.covered.length
              ? 'Black boxes or marks drawn over text that is still in the file: anyone can copy it out.'
              : 'No text was found under dark boxes.'
        }
      >
        <ul className="flex flex-col gap-1">
          {r.covered.map((c, i) => (
            <li key={i}>
              p.{c.page + 1}: <span className="font-mono">“{c.text}”</span>
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Personal data in the text"
        count={piiTotal}
        severity="risk"
        summary={
          piiTotal ? (
            <>
              Emails, phone and ID numbers found in the text. Remove them with{' '}
              <Link href="/tools/auto-redact-pii" className="underline">
                Auto-redact personal data
              </Link>
              .
            </>
          ) : (
            'No emails, phone numbers, card, bank or ID numbers were found in the text.'
          )
        }
      >
        <ul className="flex flex-col gap-1">
          {r.pii.map((p) => (
            <li key={p.category} data-pii={p.category}>
              {LABEL[p.category]}: {p.count} <span className="font-mono text-muted-foreground">({p.examples.map(mask).join(', ')})</span>
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Attached files"
        count={r.attachments.length}
        severity="risk"
        summary={r.attachments.length ? 'Files carried inside the PDF.' : 'No attached files.'}
      >
        <ul className="flex flex-col gap-1">
          {r.attachments.map((a, i) => (
            <li key={i} className="font-mono">
              {a.name}
              {a.size != null ? ` · ${formatBytes(a.size)}` : ''}
              {a.page != null ? ` · page ${a.page + 1}` : ''}
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Scripts and actions"
        count={r.javascript.length + r.actions.length}
        severity="risk"
        summary={r.javascript.length + r.actions.length ? 'JavaScript or actions that run, launch programs or send data.' : 'No JavaScript or automatic actions.'}
      >
        <ul className="flex flex-col gap-1">
          {r.javascript.map((j, i) => (
            <li key={`j${i}`}>
              {j.where}: <span className="font-mono text-muted-foreground">{j.snippet}</span>
            </li>
          ))}
          {r.actions.map((a, i) => (
            <li key={`a${i}`}>
              {a.where}: {a.kind} action
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Comments and markups"
        count={r.annotations.length}
        severity="risk"
        summary={r.annotations.length ? 'Notes, highlights and stamps, often with the reviewer’s name and time.' : 'No comments or markups.'}
      >
        <ul className="flex flex-col gap-1">
          {r.annotations.slice(0, 100).map((a, i) => (
            <li key={i}>
              p.{a.page + 1} {a.type}
              {a.author ? ` by ${a.author}` : ''}
              {a.date ? `, ${a.date}` : ''}
              {a.contents ? `: “${a.contents}”` : ''}
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Form fields"
        count={filled.length}
        severity="risk"
        summary={
          r.fields.length
            ? `${r.fields.length} ${r.fields.length === 1 ? 'field' : 'fields'}, ${filled.length} filled in${r.signatures ? `, ${r.signatures} signature ${r.signatures === 1 ? 'field' : 'fields'}` : ''}.`
            : 'No form fields.'
        }
      >
        <KeyValues rows={filled.map((f) => ({ key: f.name || `p.${f.page + 1} ${f.type}`, value: f.value }))} />
      </Finding>
      <Finding
        title="Hidden layers"
        count={hiddenLayers.length}
        severity="risk"
        summary={
          r.layers.length
            ? `${r.layers.length} ${r.layers.length === 1 ? 'layer' : 'layers'}, ${hiddenLayers.length} hidden by default. Hidden layers can hold content you do not see but others can switch on.`
            : 'No layers.'
        }
      >
        <p>{hiddenLayers.map((l) => l.name).join(', ')}</p>
        <p className="mt-1 text-muted-foreground">Cleaning can cut the content of hidden layers out of the pages (visible layers stay).</p>
      </Finding>
      <Finding
        title="Metadata inside pictures"
        count={r.imageMeta.withMeta}
        severity="risk"
        summary={
          r.imageMeta.images
            ? `${r.imageMeta.images} JPEG ${r.imageMeta.images === 1 ? 'picture' : 'pictures'}, ${r.imageMeta.withMeta} with camera or editing metadata inside (EXIF can hold the camera, the date taken and a GPS location).`
            : 'No JPEG pictures.'
        }
      >
        <ul className="flex flex-col gap-1">
          {r.imageMeta.details.map((d, i) => (
            <li key={i} className="break-all">
              {d}
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Links to websites"
        count={r.links.length}
        severity="note"
        summary={r.links.length ? 'Opening these contacts the site; links can carry tracking parameters.' : 'No external links.'}
      >
        <ul className="flex flex-col gap-1">
          {r.links.slice(0, 100).map((l, i) => (
            <li key={i} className="break-all font-mono">
              p.{l.page + 1}: {l.uri}
            </li>
          ))}
        </ul>
      </Finding>
      <Finding
        title="Fonts"
        count={r.fonts.length}
        severity="note"
        summary={
          r.fonts.length
            ? `${r.fonts.length} ${r.fonts.length === 1 ? 'font' : 'fonts'}${unembedded.length ? `, ${unembedded.length} not embedded (the reader substitutes them)` : ', all embedded'}. Font names can hint at the software and system used.`
            : 'No fonts (no text drawn).'
        }
      >
        <p>{r.fonts.map((f) => `${f.name}${f.embedded ? '' : ' (not embedded)'}`).join(', ')}</p>
      </Finding>
      <Finding
        title="File identifier"
        count={r.ids.length ? 1 : 0}
        severity="note"
        summary={r.ids.length ? 'A unique ID that can link copies and versions of this file together. Cleaning can remove it.' : 'No file identifier.'}
      >
        <p className="break-all font-mono">{r.ids.join(' · ')}</p>
      </Finding>
    </SectionCard>
  );
}

type Scan = { key: string; report: PrivacyReport | null; error: string | null };

export default function PrivacyScanner({ tool }: ToolProps) {
  const [password, setPassword] = useState('');
  const [clean, setClean] = useState<CleanOptions>({
    metadata: true,
    attachments: true,
    javascript: true,
    comments: false,
    formValues: false,
    covered: true,
    hiddenLayers: true,
    imageMetadata: true,
    fileId: true,
  });
  const [scan, setScan] = useState<Scan | null>(null);
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ clean, password, onReport }), [clean, password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const file = wb.files[0]?.file ?? null;

  // Results are keyed by file and password; anything else means a scan is under way.
  const currentKey = wb.files[0] ? `${wb.files[0].id}:${password}` : null;
  useEffect(() => {
    if (!file || !currentKey) return;
    const ctl = new AbortController();
    piiEngine
      .privacy(file, { signal: ctl.signal, password: password || undefined })
      .then((report) => setScan({ key: currentKey, report, error: null }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setScan({
          key: currentKey,
          report: null,
          error: isPasswordError(err) ? 'This PDF needs its password. Enter it under Options.' : err instanceof Error ? err.message : 'The file could not be scanned.',
        });
      });
    return () => ctl.abort();
  }, [file, password, currentKey]);

  useEffect(() => () => piiEngine.close(), []);

  const set = (key: keyof CleanOptions) => (v: boolean) => setClean((c) => ({ ...c, [key]: v }));
  const done = scan && scan.key === currentKey ? scan : null;
  const scanning = !!file && !done;
  const r = done?.report ?? null;
  const found = r ? Object.fromEntries(issues(r).map((i) => [i.id, i.count])) : {};
  const hint = (id: string, what: string) => (r ? `${found[id] ? `${found[id]} found. ` : 'None found. '}${what}` : what);

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      multiple={false}
      runLabel="Clean PDF"
      disabledReason={scanning ? 'Scanning the file…' : Object.values(clean).some(Boolean) ? null : 'Choose something to remove.'}
      aside={
        file ? (
          scanning ? (
            <SectionCard title="What this PDF reveals">
              <p className="text-xs text-muted-foreground">Scanning…</p>
            </SectionCard>
          ) : done?.error ? (
            <SectionCard title="What this PDF reveals">
              <p className="text-xs text-destructive" data-scan-error="">
                {done.error}
              </p>
            </SectionCard>
          ) : r ? (
            <Report report={r} />
          ) : null
        ) : null
      }
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">Clean makes a copy without the items you choose. The original is not changed.</p>
          <SwitchRow id="pv-meta" label="Metadata" hint={hint('metadata', 'Properties, XMP, thumbnails, application data.')} checked={clean.metadata} onChange={set('metadata')} />
          <SwitchRow id="pv-files" label="Attached files" hint={hint('attachments', 'Embedded files and file-attachment notes.')} checked={clean.attachments} onChange={set('attachments')} />
          <SwitchRow id="pv-js" label="Scripts and actions" hint={hint('javascript', 'JavaScript, launch and submit actions.')} checked={clean.javascript} onChange={set('javascript')} />
          <SwitchRow id="pv-covered" label="Redact text under dark boxes" hint={hint('covered', 'Removes the hidden text for real (true redaction).')} checked={clean.covered} onChange={set('covered')} />
          <SwitchRow id="pv-comments" label="Comments and markups" hint={hint('comments', 'Notes, highlights, stamps and drawings added as comments.')} checked={clean.comments} onChange={set('comments')} />
          <SwitchRow id="pv-forms" label="Text field values" hint={hint('fields', 'Empties filled-in text fields; the fields stay.')} checked={clean.formValues} onChange={set('formValues')} />
          <SwitchRow id="pv-layers" label="Hidden layers" hint={hint('layers', 'Cuts the content of layers that are switched off out of the pages.')} checked={clean.hiddenLayers} onChange={set('hiddenLayers')} />
          <SwitchRow id="pv-imgmeta" label="Metadata inside pictures" hint={hint('image-meta', 'EXIF (camera, date, GPS), XMP and IPTC in JPEG pictures; the pixels are not touched.')} checked={clean.imageMetadata} onChange={set('imageMetadata')} />
          <SwitchRow id="pv-id" label="File identifier" hint={hint('file-id', 'The ID that links copies and versions of a file.')} checked={clean.fileId} onChange={set('fileId')} />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            The cleaned file is always rewritten from scratch, which drops earlier saved versions. Personal data in the visible text is
            not changed here: use{' '}
            <Link href="/tools/auto-redact-pii" className="underline">
              Auto-redact
            </Link>
            .
          </p>
          <OptionField label="Password" htmlFor="pv-password" hint="Only for files that need a password to open. The cleaned copy has no password.">
            <PasswordInput id="pv-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} notesFor={(res) => (res.sourceId ? (reports[res.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
