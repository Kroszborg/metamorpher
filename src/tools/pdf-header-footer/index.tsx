'use client';

import { useState } from 'react';
import {
  NumberInput,
  PageRangeField,
  type PreviewContext,
  PreviewWorkbench,
  TextStyleFields,
  todayString,
} from '@/components/pdf-stage';
import { Input } from '@/components/ui/input';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import {
  type NumberStyle,
  pageRangeError,
  pdfStamp,
  type PreviewRequest,
  type SlotId,
  type TextStampSpec,
  type TextStyle,
} from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = TextStyle & {
  slots: Record<SlotId, string>;
  marginX: number;
  marginY: number;
  pages: string;
  skipFirst: number;
  numberStyle: NumberStyle;
  dateFormat: 'locale' | 'iso' | 'long';
};

const ROWS: { label: string; slots: { id: SlotId; label: string }[] }[] = [
  {
    label: 'Header',
    slots: [
      { id: 'tl', label: 'Left' },
      { id: 'tc', label: 'Centre' },
      { id: 'tr', label: 'Right' },
    ],
  },
  {
    label: 'Footer',
    slots: [
      { id: 'bl', label: 'Left' },
      { id: 'bc', label: 'Centre' },
      { id: 'br', label: 'Right' },
    ],
  },
];

function formatDate(kind: Options['dateFormat']): string {
  const d = new Date();
  if (kind === 'iso') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (kind === 'long') return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return todayString();
}

function toSpec(o: Options, file: File): TextStampSpec {
  return {
    font: o.font,
    bold: o.bold,
    size: o.size,
    color: o.color,
    slots: o.slots,
    marginX: o.marginX,
    marginY: o.marginY,
    pages: o.pages,
    skipFirst: o.skipFirst,
    // {page} is the physical page number, so skipped pages still count.
    counting: 'document',
    startNumber: 1,
    numberStyle: o.numberStyle,
    date: formatDate(o.dateFormat),
    filename: baseName(file.name),
  };
}

const job = perFile<Options>(async (input, options, ctx) => {
  ctx.onProgress(0.1, 'Stamping pages');
  const { blob } = await pdfStamp.stampText(input.file, toSpec(options, input.file), ctx.signal);
  return { name: `${baseName(input.file.name)}-header-footer.pdf`, blob };
});

const preview = (options: Options, ctx: PreviewContext): PreviewRequest => ({
  kind: 'text',
  spec: toSpec(options, ctx.file),
});

const validate = (_files: unknown, o: Options) => {
  if (Object.values(o.slots).every((t) => !t.trim())) return 'Enter text for at least one position.';
  const range = pageRangeError(o.pages);
  return range ? `Pages: ${range}` : null;
};

export default function PdfHeaderFooter({ tool }: ToolProps) {
  const [o, setO] = useState<Options>({
    font: 'helvetica',
    bold: false,
    size: 9,
    color: '#444444',
    slots: { tl: '{filename}', tc: '', tr: '{date}', bl: '', bc: '', br: 'Page {page} of {total}' },
    marginX: 36,
    marginY: 24,
    pages: '',
    skipFirst: 0,
    numberStyle: 'arabic',
    dateFormat: 'locale',
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setO((s) => ({ ...s, [key]: value }));
  const setSlot = (id: SlotId, value: string) => setO((s) => ({ ...s, slots: { ...s.slots, [id]: value } }));

  return (
    <PreviewWorkbench
      job={job}
      options={o}
      accept={tool.accept}
      runLabel="Add header & footer"
      preview={preview}
      validate={validate}
      zipName="header-footer.zip"
      optionsPanel={
        <>
          {ROWS.map((row) => (
            <fieldset key={row.label} className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-medium">{row.label}</legend>
              {row.slots.map((slot) => (
                <div key={slot.id} className="grid grid-cols-[3.25rem_1fr] items-center gap-2">
                  <label htmlFor={`hf-${slot.id}`} className="text-[0.7rem] text-muted-foreground">
                    {slot.label}
                  </label>
                  <Input
                    id={`hf-${slot.id}`}
                    value={o.slots[slot.id]}
                    maxLength={200}
                    placeholder="Empty"
                    onChange={(e) => setSlot(slot.id, e.currentTarget.value)}
                  />
                </div>
              ))}
            </fieldset>
          ))}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Tokens: <code className="font-mono">{'{page}'}</code>, <code className="font-mono">{'{total}'}</code>,{' '}
            <code className="font-mono">{'{date}'}</code>, <code className="font-mono">{'{filename}'}</code>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Date" htmlFor="hf-date">
              <OptionSelect
                id="hf-date"
                value={o.dateFormat}
                options={[
                  { value: 'locale', label: todayString() },
                  { value: 'iso', label: formatDate('iso') },
                  { value: 'long', label: formatDate('long') },
                ]}
                onChange={(v) => set('dateFormat', v)}
              />
            </OptionField>
            <OptionField label="Page numbers" htmlFor="hf-numerals">
              <OptionSelect
                id="hf-numerals"
                value={o.numberStyle}
                options={[
                  { value: 'arabic', label: '1, 2, 3' },
                  { value: 'roman-lower', label: 'i, ii, iii' },
                  { value: 'roman-upper', label: 'I, II, III' },
                ]}
                onChange={(v) => set('numberStyle', v)}
              />
            </OptionField>
          </div>
          <TextStyleFields id="hf" value={o} onChange={(v) => setO((s) => ({ ...s, ...v }))} />
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Side margin" htmlFor="hf-mx">
              <NumberInput id="hf-mx" value={o.marginX} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginX', v)} />
            </OptionField>
            <OptionField label="Edge margin" htmlFor="hf-my">
              <NumberInput id="hf-my" value={o.marginY} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginY', v)} />
            </OptionField>
          </div>
          <OptionField label="Skip first" htmlFor="hf-skip">
            <NumberInput id="hf-skip" value={o.skipFirst} min={0} max={9999} integer suffix="pages" onChange={(v) => set('skipFirst', v)} />
          </OptionField>
          <PageRangeField id="hf-pages" value={o.pages} onChange={(v) => set('pages', v)} />
        </>
      }
    />
  );
}
