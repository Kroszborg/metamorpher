'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import {
  NumberInput,
  PageRangeField,
  PositionGrid,
  type PreviewContext,
  PreviewWorkbench,
  SwitchRow,
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
  slot: SlotId;
  format: string;
  custom: string;
  numberStyle: NumberStyle;
  startNumber: number;
  skipFirst: number;
  countSkipped: boolean;
  marginX: number;
  marginY: number;
  pages: string;
};

const FORMATS = [
  { value: '{page}', label: '1' },
  { value: '{page} / {total}', label: '1 / N' },
  { value: 'Page {page} of {total}', label: 'Page 1 of N' },
  { value: 'Page {page}', label: 'Page 1' },
  { value: '- {page} -', label: '- 1 -' },
  { value: 'custom', label: 'Custom…' },
] as const;

const SLOTS: readonly SlotId[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

function toSpec(o: Options, file: File): TextStampSpec {
  const template = o.format === 'custom' ? o.custom : o.format;
  return {
    font: o.font,
    bold: o.bold,
    size: o.size,
    color: o.color,
    slots: { [o.slot]: template },
    marginX: o.marginX,
    marginY: o.marginY,
    pages: o.pages,
    skipFirst: o.skipFirst,
    counting: o.countSkipped ? 'document' : 'stamped',
    startNumber: o.startNumber,
    numberStyle: o.numberStyle,
    date: todayString(),
    filename: baseName(file.name),
  };
}

const job = perFile<Options>(async (input, options, ctx) => {
  ctx.onProgress(0.1, 'Numbering pages');
  const { blob } = await pdfStamp.stampText(input.file, toSpec(options, input.file), ctx.signal);
  return { name: `${baseName(input.file.name)}-numbered.pdf`, blob };
});

const preview = (options: Options, ctx: PreviewContext): PreviewRequest => ({
  kind: 'text',
  spec: toSpec(options, ctx.file),
});

const validate = (_files: unknown, o: Options) => {
  if (o.format === 'custom' && !o.custom.trim()) return 'Enter a custom format.';
  const range = pageRangeError(o.pages);
  return range ? `Pages: ${range}` : null;
};

export default function PdfPageNumbers({ tool }: ToolProps) {
  const [o, setO] = useState<Options>({
    font: 'helvetica',
    bold: false,
    size: 11,
    color: '#000000',
    slot: 'bc',
    format: '{page}',
    custom: 'Page {page} of {total}',
    numberStyle: 'arabic',
    startNumber: 1,
    skipFirst: 0,
    countSkipped: false,
    marginX: 36,
    marginY: 24,
    pages: '',
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setO((s) => ({ ...s, [key]: value }));

  return (
    <PreviewWorkbench
      job={job}
      options={o}
      accept={tool.accept}
      runLabel="Add page numbers"
      preview={preview}
      validate={validate}
      zipName="numbered.zip"
      optionsPanel={
        <>
          <OptionField label="Position">
            <PositionGrid label="Position" value={o.slot} positions={SLOTS} onChange={(v) => set('slot', v)} />
          </OptionField>
          <OptionField
            label="Format"
            htmlFor="pn-format"
            hint={o.format === 'custom' ? 'Tokens: {page}, {total}, {date}, {filename}.' : undefined}
          >
            <OptionSelect
              id="pn-format"
              value={o.format}
              options={FORMATS.map((f) => ({ value: f.value as string, label: f.label }))}
              onChange={(v) => set('format', v)}
            />
            {o.format === 'custom' ? (
              <Input
                aria-label="Custom format"
                value={o.custom}
                maxLength={200}
                onChange={(e) => set('custom', e.currentTarget.value)}
              />
            ) : null}
          </OptionField>
          <OptionField label="Numerals">
            <Segmented
              label="Numerals"
              value={o.numberStyle}
              options={[
                { value: 'arabic', label: '1 2 3' },
                { value: 'roman-lower', label: 'i ii iii' },
                { value: 'roman-upper', label: 'I II III' },
              ]}
              onChange={(v) => set('numberStyle', v)}
            />
          </OptionField>
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Start at" htmlFor="pn-start">
              <NumberInput id="pn-start" value={o.startNumber} min={0} max={99999} integer onChange={(v) => set('startNumber', v)} />
            </OptionField>
            <OptionField label="Skip first" htmlFor="pn-skip">
              <NumberInput id="pn-skip" value={o.skipFirst} min={0} max={9999} integer suffix="pages" onChange={(v) => set('skipFirst', v)} />
            </OptionField>
          </div>
          {o.skipFirst > 0 ? (
            <SwitchRow
              id="pn-count-skipped"
              label="Count skipped pages"
              checked={o.countSkipped}
              onChange={(v) => set('countSkipped', v)}
              hint={
                o.countSkipped
                  ? `The first numbered page shows ${o.startNumber + o.skipFirst}.`
                  : `The first numbered page shows ${o.startNumber}.`
              }
            />
          ) : null}
          <TextStyleFields id="pn" value={o} onChange={(v) => setO((s) => ({ ...s, ...v }))} />
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Side margin" htmlFor="pn-mx">
              <NumberInput id="pn-mx" value={o.marginX} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginX', v)} />
            </OptionField>
            <OptionField label="Edge margin" htmlFor="pn-my">
              <NumberInput id="pn-my" value={o.marginY} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginY', v)} />
            </OptionField>
          </div>
          <PageRangeField id="pn-pages" value={o.pages} onChange={(v) => set('pages', v)} />
        </>
      }
    />
  );
}
