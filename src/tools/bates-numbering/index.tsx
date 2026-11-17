'use client';

import { useState } from 'react';
import {
  NumberInput,
  PositionGrid,
  type PreviewContext,
  PreviewWorkbench,
  TextStyleFields,
  todayString,
} from '@/components/pdf-stage';
import { Input } from '@/components/ui/input';
import { defineJob, OptionField } from '@/components/workbench';
import {
  type BatesFormat,
  formatBates,
  pdfStamp,
  type PreviewRequest,
  type SlotId,
  type TextStampSpec,
  type TextStyle,
} from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = TextStyle &
  BatesFormat & {
    start: number;
    slot: SlotId;
    marginX: number;
    marginY: number;
  };

const SLOTS: readonly SlotId[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

function toSpec(o: Options, file: File, start: number): TextStampSpec {
  return {
    font: o.font,
    bold: o.bold,
    size: o.size,
    color: o.color,
    slots: { [o.slot]: '{bates}' },
    marginX: o.marginX,
    marginY: o.marginY,
    pages: '',
    skipFirst: 0,
    counting: 'document',
    startNumber: 1,
    numberStyle: 'arabic',
    bates: { prefix: o.prefix, suffix: o.suffix, digits: o.digits, start },
    date: todayString(),
    filename: baseName(file.name),
  };
}

const job = defineJob<Options>({
  mode: 'batch',
  async run(inputs, options, ctx) {
    const outputs = [];
    let next = options.start;
    for (const [i, input] of inputs.entries()) {
      ctx.onProgress(i / inputs.length, `File ${i + 1} of ${inputs.length}`);
      let result;
      try {
        result = await pdfStamp.stampText(input.file, toSpec(options, input.file, next), ctx.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${input.file.name}: ${message}`);
      }
      const first = formatBates(next, options);
      const last = formatBates(next + result.pageCount - 1, options);
      next += result.pageCount;
      outputs.push({ name: `${baseName(input.file.name)} (${first}-${last}).pdf`.replace(/[\\/:*?"<>|]/g, '_'), blob: result.blob });
    }
    return outputs;
  },
});

// Page counts of earlier files, so the preview shows the number this file really starts at.
const counts = new WeakMap<File, Promise<number>>();
function pageCountOf(file: File): Promise<number> {
  let p = counts.get(file);
  if (!p) {
    p = pdfStamp.pageSizes(file).then((s) => s.length);
    p.catch(() => counts.delete(file));
    counts.set(file, p);
  }
  return p;
}

const preview = async (o: Options, ctx: PreviewContext): Promise<PreviewRequest> => {
  let start = o.start;
  for (const f of ctx.files.slice(0, ctx.index)) start += await pageCountOf(f.file);
  return { kind: 'text', spec: toSpec(o, ctx.file, start) };
};

export default function BatesNumbering({ tool }: ToolProps) {
  const [o, setO] = useState<Options>({
    font: 'helvetica',
    bold: true,
    size: 10,
    color: '#000000',
    prefix: 'ABC',
    suffix: '',
    digits: 6,
    start: 1,
    slot: 'br',
    marginX: 36,
    marginY: 24,
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setO((s) => ({ ...s, [key]: value }));

  return (
    <PreviewWorkbench
      job={job}
      options={o}
      accept={tool.accept}
      reorderable
      runLabel="Add Bates numbers"
      preview={preview}
      zipName="bates.zip"
      optionsPanel={
        <>
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Prefix" htmlFor="bn-prefix">
              <Input id="bn-prefix" value={o.prefix} maxLength={40} onChange={(e) => set('prefix', e.currentTarget.value)} />
            </OptionField>
            <OptionField label="Suffix" htmlFor="bn-suffix">
              <Input id="bn-suffix" value={o.suffix} maxLength={40} onChange={(e) => set('suffix', e.currentTarget.value)} />
            </OptionField>
            <OptionField label="Digits" htmlFor="bn-digits">
              <NumberInput id="bn-digits" value={o.digits} min={1} max={12} integer onChange={(v) => set('digits', v)} />
            </OptionField>
            <OptionField label="Start at" htmlFor="bn-start">
              <NumberInput id="bn-start" value={o.start} min={0} max={999_999_999} integer onChange={(v) => set('start', v)} />
            </OptionField>
          </div>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            First number: <span className="font-mono text-foreground">{formatBates(o.start, o)}</span>. Numbering
            continues across the files in list order; drag files to change it.
          </p>
          <OptionField label="Position">
            <PositionGrid label="Position" value={o.slot} positions={SLOTS} onChange={(v) => set('slot', v)} />
          </OptionField>
          <TextStyleFields id="bn" value={o} onChange={(v) => setO((s) => ({ ...s, ...v }))} />
          <div className="grid grid-cols-2 gap-3">
            <OptionField label="Side margin" htmlFor="bn-mx">
              <NumberInput id="bn-mx" value={o.marginX} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginX', v)} />
            </OptionField>
            <OptionField label="Edge margin" htmlFor="bn-my">
              <NumberInput id="bn-my" value={o.marginY} min={0} max={300} integer suffix="pt" onChange={(v) => set('marginY', v)} />
            </OptionField>
          </div>
        </>
      }
    />
  );
}
