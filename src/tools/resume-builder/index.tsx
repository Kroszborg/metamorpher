'use client';

import { DragDropContext, Draggable, type DraggableProvidedDragHandleProps, Droppable } from '@hello-pangea/dnd';
import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon, DragDropVerticalIcon, FileImportIcon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { AreaField, fileStem, JsonButtons, TextField } from '@/components/business/form-bits';
import { HtmlPreview } from '@/components/business/html-preview';
import { previewDocument } from '@/components/business/html';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { EngineNote, type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ResultFile, RunBar } from '@/components/workbench';
import { isAbortError } from '@/engines';
import { TYPESET_DOWNLOAD_BYTES, typesetEngine } from '@/engines/typeset';
import { newId } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import {
  ACCENTS,
  clearDraft,
  emptyResume,
  type Entry,
  type FontId,
  type Margins,
  KIND_LABEL,
  loadDraft,
  newEntry,
  newSection,
  type PaperId,
  parseResume,
  type Resume,
  sampleResume,
  saveDraft,
  type Section,
  type SectionKind,
  serializeResume,
  type Spacing,
} from './model';
import { BULLET } from './inline';
import { renderResume, TEMPLATES } from './render';

// CodeMirror and the TeX engine load only when LaTeX mode is opened.
const LatexMode = lazy(() => import('./latex/latex-mode').then((m) => ({ default: m.LatexMode })));

const subscribeNothing = () => () => undefined;

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
}

function IconButton({ label, icon, onClick, disabled }: { label: string; icon: typeof Add01Icon; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <HugeiconsIcon icon={icon} strokeWidth={2} />
    </Button>
  );
}

const FIELDS: Record<SectionKind, { title?: string; org?: string; location?: boolean; dates?: boolean; url?: string; text: string; textHint?: string }> = {
  summary: { text: 'Summary', textHint: 'Two or three sentences: who you are and what you are best at.' },
  experience: { title: 'Role', org: 'Company', location: true, dates: true, text: 'What you did', textHint: 'One achievement per line, starting with "-". Numbers help.' },
  education: { title: 'Degree', org: 'School or university', location: true, dates: true, text: 'Details', textHint: 'Grades, honours, relevant courses.' },
  projects: { title: 'Project', url: 'Link', dates: true, text: 'Description', textHint: 'Lines starting with "-" become bullets.' },
  skills: { title: 'Group', text: 'Skills', textHint: 'Comma-separated.' },
  links: { title: 'Label', url: 'URL', text: '' },
  custom: { title: 'Title', org: 'Organisation', dates: true, text: 'Details' },
};

/** A textarea with buttons for the rich-text syntax (**bold**, *italic*, [link](url), "- " bullets). */
function RichArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const wrap = (before: string, after: string, placeholder: string) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const inner = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + inner + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + inner.length);
    });
  };
  const bullets = () => {
    const el = area.current;
    if (!el) return;
    const a = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const b = el.selectionEnd;
    const block = value
      .slice(a, b)
      .split('\n')
      .map((l) => (BULLET.test(l.trim()) ? l : `- ${l}`))
      .join('\n');
    onChange(value.slice(0, a) + block + value.slice(b));
    requestAnimationFrame(() => el.focus());
  };
  const tool = 'h-6 min-w-6 rounded px-1.5 text-[0.7rem] text-muted-foreground hover:bg-muted hover:text-foreground';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[0.7rem] font-medium text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-0.5" role="toolbar" aria-label={`${label} formatting`}>
          <button type="button" className={cn(tool, 'font-bold')} title="Bold (**text**)" onClick={() => wrap('**', '**', 'bold')}>
            B
          </button>
          <button type="button" className={cn(tool, 'italic')} title="Italic (*text*)" onClick={() => wrap('*', '*', 'italic')}>
            I
          </button>
          <button type="button" className={tool} title="Link ([text](https://…))" onClick={() => wrap('[', '](https://)', 'link text')}>
            Link
          </button>
          <button type="button" className={tool} title="Bulleted lines (- )" onClick={bullets}>
            • List
          </button>
        </div>
      </div>
      <Textarea
        ref={area}
        id={id}
        value={value}
        rows={rows}
        maxLength={8000}
        className="min-h-0"
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function EntryEditor({
  kind,
  entry,
  onChange,
}: {
  kind: SectionKind;
  entry: Entry;
  onChange: (e: Entry) => void;
}) {
  const f = FIELDS[kind];
  const set = (p: Partial<Entry>) => onChange({ ...entry, ...p });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {f.title ? <TextField label={f.title} value={entry.title} onChange={(title) => set({ title })} maxLength={300} /> : null}
      {f.org ? <TextField label={f.org} value={entry.org} onChange={(org) => set({ org })} maxLength={300} /> : null}
      {f.url ? <TextField label={f.url} value={entry.url} onChange={(url) => set({ url })} maxLength={500} inputMode="url" /> : null}
      {f.location ? <TextField label="Location" value={entry.location} onChange={(location) => set({ location })} /> : null}
      {f.dates ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Start" value={entry.start} placeholder="Jan 2022" onChange={(start) => set({ start })} maxLength={40} />
          <TextField label="End" value={entry.end} placeholder="Present" onChange={(end) => set({ end })} maxLength={40} />
        </div>
      ) : null}
      {f.text ? (
        <div className="sm:col-span-2">
          {kind === 'skills' ? (
            <AreaField label={f.text} value={entry.text} onChange={(text) => set({ text })} rows={1} maxLength={2000} />
          ) : (
            <RichArea label={f.text} value={entry.text} onChange={(text) => set({ text })} rows={kind === 'summary' ? 3 : 4} />
          )}
          {f.textHint ? <p className="mt-1 text-[0.7rem]/relaxed text-muted-foreground">{f.textHint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const HANDLE =
  'grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-faint outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 active:cursor-grabbing';

function SectionEditor({
  section,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  handle,
}: {
  section: Section;
  index: number;
  count: number;
  onChange: (s: Section) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  handle: DraggableProvidedDragHandleProps | null | undefined;
}) {
  const setEntry = (i: number, e: Entry) => onChange({ ...section, entries: section.entries.map((x, j) => (j === i ? e : x)) });
  const single = section.kind === 'summary';
  return (
    <section className={cn('rounded-xl border bg-card', section.hidden && 'opacity-60')} data-section={section.kind}>
      <div className="flex items-center gap-1.5 border-b px-2 py-2">
        <span {...handle} aria-label={`Drag to reorder the ${section.title || KIND_LABEL[section.kind]} section`} className={HANDLE}>
          <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} className="size-4" />
        </span>
        <Input
          aria-label="Section title"
          value={section.title}
          maxLength={60}
          onChange={(e) => onChange({ ...section, title: e.currentTarget.value })}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent font-display text-sm font-semibold shadow-none focus-visible:border-ring dark:bg-transparent"
        />
        <span className="hidden text-[0.7rem] text-muted-foreground sm:inline">{KIND_LABEL[section.kind]}</span>
        <div className="flex shrink-0">
          <IconButton label={section.hidden ? 'Show section' : 'Hide section'} icon={section.hidden ? ViewOffSlashIcon : ViewIcon} onClick={() => onChange({ ...section, hidden: !section.hidden })} />
          <IconButton label="Move section up" icon={ArrowUp01Icon} onClick={() => onMove(-1)} disabled={index === 0} />
          <IconButton label="Move section down" icon={ArrowDown01Icon} onClick={() => onMove(1)} disabled={index === count - 1} />
          <IconButton label="Delete section" icon={Delete02Icon} onClick={onRemove} />
        </div>
      </div>
      <Droppable droppableId={`entries:${section.id}`} type={`entry:${section.id}`}>
        {(drop) => (
          <div ref={drop.innerRef} {...drop.droppableProps} className="flex flex-col gap-3 p-3">
            {section.entries.map((e, i) => (
              <Draggable key={e.id} draggableId={e.id} index={i} isDragDisabled={single}>
                {(drag, snap) => (
                  <div
                    ref={drag.innerRef}
                    {...drag.draggableProps}
                    className={cn('flex flex-col gap-2', !single && 'rounded-lg border bg-card p-2.5', snap.isDragging && 'shadow-lg')}
                  >
                    {!single && section.entries.length > 1 ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1">
                          <span {...drag.dragHandleProps} aria-label={`Drag to reorder ${e.title || e.org || `entry ${i + 1}`}`} className={HANDLE}>
                            <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} className="size-4" />
                          </span>
                          <span className="truncate text-[0.7rem] font-medium text-muted-foreground">{e.title || e.org || `Entry ${i + 1}`}</span>
                        </span>
                        <div className="flex shrink-0">
                          <IconButton label="Move entry up" icon={ArrowUp01Icon} onClick={() => onChange({ ...section, entries: move(section.entries, i, -1) })} disabled={i === 0} />
                          <IconButton
                            label="Move entry down"
                            icon={ArrowDown01Icon}
                            onClick={() => onChange({ ...section, entries: move(section.entries, i, 1) })}
                            disabled={i === section.entries.length - 1}
                          />
                          <IconButton label="Delete entry" icon={Delete02Icon} onClick={() => onChange({ ...section, entries: section.entries.filter((_, j) => j !== i) })} />
                        </div>
                      </div>
                    ) : (
                      <span {...drag.dragHandleProps} className="hidden" />
                    )}
                    <EntryEditor kind={section.kind} entry={e} onChange={(next) => setEntry(i, next)} />
                  </div>
                )}
              </Draggable>
            ))}
            {drop.placeholder}
            {!single ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={section.entries.length >= 80}
                onClick={() => onChange({ ...section, entries: [...section.entries, newEntry()] })}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Add {section.kind === 'skills' ? 'skill group' : section.kind === 'links' ? 'link' : 'entry'}
              </Button>
            ) : null}
          </div>
        )}
      </Droppable>
    </section>
  );
}

/** How full the pages are, estimated from the preview's height (the PDF breaks a little differently). */
function PageFit({ heightPx, pageHeightPt, marginPt, pdfPages }: { heightPx: number; pageHeightPt: number; marginPt: number; pdfPages: number | null }) {
  if (!heightPx) return null;
  const usable = ((pageHeightPt - 2 * marginPt) * 4) / 3;
  const pages = Math.max(0, heightPx - (2 * marginPt * 4) / 3) / usable;
  const whole = Math.max(1, Math.ceil(pages - 0.02));
  const fill = Math.round((pages - (whole - 1)) * 100);
  const over = whole > 1 && fill < 25;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs" data-page-fit>
      <span className={cn('font-medium', over ? 'text-warning' : 'text-foreground')}>
        {whole === 1 ? `Fits on 1 page (${fill}% full)` : over ? `Spills onto page ${whole} (${fill}% of it)` : `About ${whole} pages (last ${fill}% full)`}
      </span>
      <span className="text-[0.7rem] text-muted-foreground">
        {over ? 'Tighten spacing, margins or text size to save a page.' : pdfPages ? `Last PDF: ${pdfPages} ${pdfPages === 1 ? 'page' : 'pages'}` : 'Estimate from the preview'}
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('block h-full rounded-full', over ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, fill)}%` }} />
      </span>
    </div>
  );
}

/** Moves an item from one index to another. */
function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export default function ResumeBuilder(_props: ToolProps) {
  const [resume, setResume] = useState<Resume>(sampleResume);
  const [mode, setMode] = useState<'form' | 'latex'>('form');
  const [contentPx, setContentPx] = useState(0);
  const [pdfPages, setPdfPages] = useState(0);
  // Drag-and-drop ids are random, so the sortable list renders on the client only (no hydration mismatch).
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [restored, setRestored] = useState(false);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string>();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const abort = useRef<AbortController | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const ready = useRef(false);

  // Restore the autosaved draft once, then save every change (debounced).
  useEffect(() => {
    const d = loadDraft();
    if (d) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
      setResume(d);
      setRestored(true);
    }
    ready.current = true;
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => saveDraft(resume), 500);
    return () => clearTimeout(t);
  }, [resume]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  const set = (p: Partial<Resume>) => setResume((r) => ({ ...r, ...p }));
  const setProfile = (p: Partial<Resume['profile']>) => setResume((r) => ({ ...r, profile: { ...r.profile, ...p } }));
  const doc = useMemo(() => renderResume(resume), [resume]);
  const previewHtml = useMemo(
    () => previewDocument(doc.body, doc.css, { width: doc.width, margin: doc.margin }),
    [doc],
  );

  async function create() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProgress(0);
    setResult(null);
    setNotes([]);
    try {
      const out = await typesetEngine.render(
        {
          blocks: [{ kind: 'html', html: doc.body }],
          css: doc.css,
          page: { width: doc.width, height: doc.height, margin: { top: doc.margin.y, bottom: doc.margin.y, left: doc.margin.x, right: doc.margin.x } },
          fontSize: doc.fontSize,
          outline: false,
          pageNumbers: false,
          title: `${resume.profile.name.trim() || 'Résumé'}${resume.profile.headline.trim() ? ` – ${resume.profile.headline.trim()}` : ''}`,
          author: resume.profile.name.trim() || undefined,
          lang: 'en',
        },
        {
          signal: controller.signal,
          onProgress: (d, _t, n) => {
            setProgress(d);
            setNote(n);
          },
        },
      );
      const name = `${fileStem(resume.profile.name || 'resume', 'resume')}-resume.pdf`;
      setResult({ id: newId('r'), name, blob: out.blob, url: URL.createObjectURL(out.blob) });
      setPdfPages(out.pages);
      const n: ResultNote[] = [{ kind: 'ok', text: `${out.pages} ${out.pages === 1 ? 'page' : 'pages'}; all text is real, selectable and in reading order for applicant tracking systems.` }];
      if (out.pages > 2) n.push({ kind: 'info', text: 'Most recruiters prefer one or two pages. The Compact template or a smaller text size can help.' });
      if (out.missing.length) n.push({ kind: 'warn', text: `Some characters could not be shown: ${out.missing.join(' ')}` });
      setNotes(n);
    } catch (err) {
      if (!isAbortError(err)) toast.error(err instanceof Error ? err.message : 'Could not create the PDF.');
      else toast.info('Cancelled.');
    } finally {
      abort.current = null;
      setRunning(false);
      setNote(undefined);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      const { draftFromLines, linesFromDocx, linesFromPdf } = await import('./import');
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const lines = isPdf ? await linesFromPdf(file) : await linesFromDocx(file);
      const draft = draftFromLines(lines);
      setResume((r) => ({ ...draft, template: r.template, accent: r.accent, paper: r.paper, font: r.font, size: r.size }));
      toast.success(`Imported ${draft.sections.length} sections from ${file.name}. Check every field: the split is a best guess.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'This file could not be read.');
    } finally {
      setImporting(false);
    }
  }

  const sections = resume.sections;
  const updateSection = (i: number, s: Section) => setResume((r) => ({ ...r, sections: r.sections.map((x, j) => (j === i ? s : x)) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<'form' | 'latex'>
          label="Editor"
          value={mode}
          options={[
            { value: 'form', label: 'Form' },
            { value: 'latex', label: 'LaTeX' },
          ]}
          onChange={setMode}
        />
        <p className="text-[0.7rem] text-muted-foreground">
          {mode === 'form' ? 'Fill in the form; the preview is the PDF layout.' : 'Edit real LaTeX; start from a template or from your form.'}
        </p>
      </div>
      {mode === 'latex' ? (
        <Suspense fallback={<p className="py-10 text-center text-xs text-muted-foreground">Loading the editor…</p>}>
          <LatexMode resume={resume} />
        </Suspense>
      ) : (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <fieldset disabled={running || importing} className="flex min-w-0 flex-col gap-4">
        <SectionCard
          title="Profile"
          description={restored ? 'Restored your draft from this browser.' : 'Saved as you type, in this browser only.'}
          contentClassName="grid gap-3 sm:grid-cols-2"
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => importInput.current?.click()} disabled={importing}>
              <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
              {importing ? 'Reading…' : 'Import PDF/DOCX'}
            </Button>
          }
        >
          <input
            ref={importInput}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            tabIndex={-1}
            aria-label="Import an existing résumé"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void importFile(f);
            }}
          />
          <TextField label="Full name" value={resume.profile.name} onChange={(name) => setProfile({ name })} />
          <TextField label="Headline" value={resume.profile.headline} placeholder="Senior Data Analyst" onChange={(headline) => setProfile({ headline })} />
          <TextField label="Email" value={resume.profile.email} inputMode="email" onChange={(email) => setProfile({ email })} />
          <TextField label="Phone" value={resume.profile.phone} inputMode="tel" onChange={(phone) => setProfile({ phone })} />
          <TextField label="Location" value={resume.profile.location} onChange={(location) => setProfile({ location })} />
          <TextField label="Website" value={resume.profile.website} inputMode="url" onChange={(website) => setProfile({ website })} />
          <TextField label="LinkedIn" value={resume.profile.linkedin} inputMode="url" onChange={(linkedin) => setProfile({ linkedin })} />
          <TextField label="GitHub" value={resume.profile.github} inputMode="url" onChange={(github) => setProfile({ github })} />
        </SectionCard>

        {hydrated ? (
        <DragDropContext
          onDragEnd={(res) => {
            const to = res.destination;
            if (!to) return;
            if (res.type === 'section') {
              setResume((r) => ({ ...r, sections: reorder(r.sections, res.source.index, to.index) }));
            } else if (to.droppableId === res.source.droppableId) {
              const id = to.droppableId.slice('entries:'.length);
              setResume((r) => ({
                ...r,
                sections: r.sections.map((s) => (s.id === id ? { ...s, entries: reorder(s.entries, res.source.index, to.index) } : s)),
              }));
            }
          }}
        >
          <Droppable droppableId="sections" type="section">
            {(drop) => (
              <div ref={drop.innerRef} {...drop.droppableProps} className="flex flex-col gap-4" aria-label="Sections, in order. Drag a handle or use Space and the arrow keys.">
                {sections.map((s, i) => (
                  <Draggable key={s.id} draggableId={s.id} index={i}>
                    {(drag, snap) => (
                      <div ref={drag.innerRef} {...drag.draggableProps} className={cn(snap.isDragging && 'rounded-xl shadow-xl')}>
                        <SectionEditor
                          section={s}
                          index={i}
                          count={sections.length}
                          handle={drag.dragHandleProps}
                          onChange={(next) => updateSection(i, next)}
                          onMove={(d) => setResume((r) => ({ ...r, sections: move(r.sections, i, d) }))}
                          onRemove={() => setResume((r) => ({ ...r, sections: r.sections.filter((_, j) => j !== i) }))}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {drop.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        ) : null}

        <SectionCard title="Add a section" contentClassName="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as SectionKind[]).map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => setResume((r) => ({ ...r, sections: [...r.sections, newSection(k)] }))}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              {KIND_LABEL[k]}
            </Button>
          ))}
        </SectionCard>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <SectionCard
          title="Preview"
          contentClassName="flex flex-col gap-3"
          action={
            <Segmented<PaperId>
              label="Paper"
              value={resume.paper}
              options={[
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Letter' },
              ]}
              onChange={(paper) => set({ paper })}
            />
          }
        >
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={resume.template === t.id}
                title={t.hint}
                onClick={() => set({ template: t.id, font: t.id === 'classic' ? 'serif' : t.id === 'compact' ? 'calibri' : resume.font === 'serif' || resume.font === 'calibri' ? 'sans' : resume.font })}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  resume.template === t.id ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<FontId>
              label="Font"
              value={resume.font}
              options={[
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
                { value: 'calibri', label: 'Carlito' },
              ]}
              onChange={(font) => set({ font })}
            />
            <Segmented<Resume['size']>
              label="Text size"
              value={resume.size}
              options={[
                { value: 'small', label: 'S' },
                { value: 'medium', label: 'M' },
                { value: 'large', label: 'L' },
              ]}
              onChange={(size) => set({ size })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<Spacing>
              label="Spacing"
              value={resume.spacing}
              options={[
                { value: 'compact', label: 'Tight' },
                { value: 'normal', label: 'Normal' },
                { value: 'relaxed', label: 'Airy' },
              ]}
              onChange={(spacing) => set({ spacing })}
            />
            <Segmented<Margins>
              label="Margins"
              value={resume.margins}
              options={[
                { value: 'narrow', label: 'Narrow' },
                { value: 'normal', label: 'Normal' },
                { value: 'wide', label: 'Wide' },
              ]}
              onChange={(margins) => set({ margins })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={resume.accent === c}
                aria-label={`Accent ${c}`}
                onClick={() => set({ accent: c })}
                className={cn('size-6 rounded-full border-2', resume.accent === c ? 'border-foreground' : 'border-transparent')}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom accent colour"
              value={resume.accent}
              onChange={(e) => set({ accent: e.currentTarget.value })}
              className="h-6 w-8 cursor-pointer rounded border bg-transparent p-0.5"
            />
          </div>
          <PageFit heightPx={contentPx} pageHeightPt={doc.height} marginPt={doc.margin.y} pdfPages={result ? pdfPages : null} />
          <HtmlPreview html={previewHtml} pageWidth={doc.width} pageHeight={doc.height} maxHeight={760} title="Résumé preview" onMeasure={setContentPx} />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">Dashed lines mark roughly where pages end; the PDF breaks between lines and entries.</p>
          <JsonButtons
            fileName={() => `${fileStem(resume.profile.name || 'resume', 'resume')}-resume.json`}
            serialize={() => serializeResume(resume)}
            onLoad={(text) => {
              setResume(parseResume(text));
              setResult(null);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setResume(emptyResume())}>
              Start blank
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setResume(sampleResume())}>
              Load the example
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                ready.current = false;
                clearDraft();
                setResume(emptyResume());
                setRestored(false);
                setTimeout(() => {
                  clearDraft();
                  ready.current = true;
                }, 600);
                toast.success('Removed the saved draft from this browser.');
              }}
            >
              Delete saved draft
            </Button>
          </div>
          <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
        </SectionCard>
        <RunBar
          label="Create PDF"
          running={running}
          progress={progress}
          note={note}
          disabledReason={resume.profile.name.trim() || sections.length ? null : 'Add your name first.'}
          onRun={create}
          onCancel={() => abort.current?.abort()}
        />
        {result ? <ResultRows results={[result]} notesFor={() => notes} /> : null}
      </div>
    </div>
      )}
    </div>
  );
}
