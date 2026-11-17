'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import {
  BODY_SIZE,
  defaultPageSetup,
  geometryOf,
  imageNotes,
  markdownToHtml,
  type PageSetup,
  PageSetupFields,
  prepareHtml,
  resultNotes,
} from '@/components/doc-tools';
import { EngineNote, type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OptionField, type ResultFile, RunBar } from '@/components/workbench';
import { isAbortError } from '@/engines';
import { documentCss, TYPESET_DOWNLOAD_BYTES, typesetEngine } from '@/engines/typeset';
import { newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Font = 'sans' | 'serif';

const STARTER = `# Title

Write here. **Bold**, *italic*, [links](https://example.com) and \`code\` work as in Markdown.

## A section

- A list item
- Another one

| Column | Another |
|--------|---------|
| Cell   | Cell    |
`;

/** Toolbar actions: wrap the selection or start the selected lines with a prefix. */
const ACTIONS: { label: string; title: string; wrap?: [string, string]; line?: string; insert?: string }[] = [
  { label: 'H1', title: 'Heading 1', line: '# ' },
  { label: 'H2', title: 'Heading 2', line: '## ' },
  { label: 'B', title: 'Bold', wrap: ['**', '**'] },
  { label: 'I', title: 'Italic', wrap: ['*', '*'] },
  { label: '• List', title: 'Bulleted list', line: '- ' },
  { label: '1. List', title: 'Numbered list', line: '1. ' },
  { label: '❝ Quote', title: 'Quote', line: '> ' },
  { label: '</> Code', title: 'Code block', wrap: ['\n```\n', '\n```\n'] },
  { label: 'Table', title: 'Table', insert: '\n| Column | Column |\n|--------|--------|\n| Cell   | Cell   |\n' },
  { label: 'Page break', title: 'Start a new page', insert: '\n<div style="page-break-after: always"></div>\n' },
];

export default function CreatePdf(_props: ToolProps) {
  const [name, setName] = useState('document');
  const [text, setText] = useState(STARTER);
  const [font, setFont] = useState<Font>('sans');
  const [setup, setSetup] = useState<PageSetup>(() => defaultPageSetup());
  const [images, setImages] = useState<Map<string, File>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string>();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  function edit(action: (typeof ACTIONS)[number] | { insert: string }) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    let next = value;
    let cursor = b;
    if ('wrap' in action && action.wrap) {
      const [open, close] = action.wrap;
      next = value.slice(0, a) + open + value.slice(a, b) + close + value.slice(b);
      cursor = b + open.length + close.length;
    } else if ('line' in action && action.line) {
      const start = value.lastIndexOf('\n', a - 1) + 1;
      const block = value.slice(start, b).split('\n').map((l) => action.line + l).join('\n');
      next = value.slice(0, start) + block + value.slice(b);
      cursor = start + block.length;
    } else if (action.insert) {
      next = value.slice(0, a) + action.insert + value.slice(b);
      cursor = a + action.insert.length;
    }
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function addImages(files: FileList | null) {
    if (!files?.length) return;
    const next = new Map(images);
    let snippet = '';
    for (const f of files) {
      const key = f.name.replace(/\s+/g, '-');
      next.set(key.toLowerCase(), f);
      snippet += `\n![${f.name.replace(/\.[^.]+$/, '')}](${key})\n`;
    }
    setImages(next);
    edit({ insert: snippet });
  }

  async function create() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProgress(0);
    setResult(null);
    setNotes([]);
    try {
      const md = await markdownToHtml(text);
      const html = await prepareHtml(md.html, { resources: images, keepStyles: true });
      const fontSize = BODY_SIZE[setup.textSize];
      const title = name.trim() || 'document';
      const out = await typesetEngine.render(
        {
          blocks: [{ kind: 'html', html: html.body }],
          css: `${documentCss({ fontSize, font })}\n${html.css}`,
          page: geometryOf(setup),
          fontSize,
          outline: setup.outline,
          pageNumbers: setup.pageNumbers,
          title: md.title ?? title,
        },
        {
          signal: controller.signal,
          onProgress: (d, _t, n) => {
            setProgress(d);
            setNote(n);
          },
        },
      );
      const fileName = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
      setResult({ id: newId('r'), name: fileName, blob: out.blob, url: URL.createObjectURL(out.blob) });
      setNotes([...resultNotes(out, setup), ...imageNotes(html)]);
    } catch (err) {
      if (!isAbortError(err)) toast.error(err instanceof Error ? err.message : 'Could not create the PDF.');
      else toast.info('Cancelled.');
    } finally {
      abort.current = null;
      setRunning(false);
      setNote(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title="Document"
          description="Markdown: # headings, **bold**, - lists, tables, images. Nothing is saved or uploaded."
          contentClassName="flex flex-col gap-3"
        >
          <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formatting">
            {ACTIONS.map((a) => (
              <Button key={a.label} size="sm" variant="outline" title={a.title} onClick={() => edit(a)} disabled={running}>
                {a.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => picker.current?.click()} disabled={running}>
              Image…
            </Button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addImages(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <Textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck
            className="min-h-[28rem] font-mono text-xs/relaxed"
            aria-label="Document text"
            disabled={running}
          />
          {images.size > 0 ? (
            <p className="text-[0.7rem] text-muted-foreground">Images: {[...images.values()].map((f) => f.name).join(', ')}</p>
          ) : null}
        </SectionCard>
        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <SectionCard title="Options" contentClassName="flex flex-col gap-4">
            <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
              <OptionField label="File name" htmlFor="cp-name">
                <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} />
              </OptionField>
              <OptionField label="Typeface">
                <Segmented<Font>
                  label="Typeface"
                  value={font}
                  options={[
                    { value: 'sans', label: 'Sans serif' },
                    { value: 'serif', label: 'Serif' },
                  ]}
                  onChange={setFont}
                />
              </OptionField>
              <PageSetupFields id="cp" value={setup} onChange={setSetup} />
              <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
            </fieldset>
          </SectionCard>
          <RunBar
            label="Create PDF"
            running={running}
            progress={progress}
            note={note}
            disabledReason={text.trim() ? null : 'Write something first.'}
            onRun={create}
            onCancel={() => abort.current?.abort()}
          />
        </div>
      </div>
      {result ? <ResultRows results={[result]} notesFor={() => notes} /> : null}
    </div>
  );
}
