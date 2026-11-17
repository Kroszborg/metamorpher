'use client';

import { useCallback, useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, mupdfEngine } from '@/engines/mupdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = {
  applyMasks: boolean;
  cmykToRgb: boolean;
  minSize: number;
  password: string;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const base = baseName(file.name);
  const { images, skipped } = await mupdfEngine.extractImages(
    file,
    { applyMasks: o.applyMasks, cmykToRgb: o.cmykToRgb, minSize: o.minSize },
    {
      signal: ctx.signal,
      password: o.password || undefined,
      onProgress: (done, total) => ctx.onProgress((done / Math.max(1, total)) * 0.8, `Page ${done} of ${total}`),
    },
  );
  if (images.length === 0) {
    throw new Error(
      skipped > 0
        ? `Only ${skipped} small ${skipped === 1 ? 'image was' : 'images were'} found and skipped. Lower the minimum size to keep them.`
        : 'This PDF has no embedded images: its pages are text and drawings only. To save whole pages as pictures, use PDF to images.',
    );
  }
  const originals = images.filter((i) => i.source === 'original').length;
  const decoded = images.length - originals;
  const notes: ResultNote[] = [
    {
      kind: 'ok',
      text: [
        `${images.length} ${images.length === 1 ? 'image' : 'images'}`,
        originals ? `${originals} saved exactly as stored (JPEG/JPEG 2000)` : null,
        decoded ? `${decoded} decoded losslessly to PNG` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  ];
  if (skipped) notes.push({ kind: 'info', text: `${skipped} skipped (smaller than the minimum size, stencil masks or unreadable).` });
  o.onReport(input.id, notes);

  if (images.length === 1 && images[0]) {
    const img = images[0];
    return { name: `${base}-${img.name}.${img.ext}`, blob: img.blob };
  }
  ctx.onProgress(0.85, 'Packing the ZIP');
  const zip = new ctx.engines.archive.ZipWriter();
  for (const img of images) await zip.add(`${img.name}.${img.ext}`, img.blob);
  return { name: `${base}-images.zip`, blob: zip.finish() };
});

export default function ExtractPdfImages({ tool }: ToolProps) {
  const [applyMasks, setApplyMasks] = useState(true);
  const [cmykToRgb, setCmykToRgb] = useState(true);
  const [minSize, setMinSize] = useState(32);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(
    () => ({ applyMasks, cmykToRgb, minSize, password, onReport }),
    [applyMasks, cmykToRgb, minSize, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Extract images"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Saves the pictures embedded in the PDF at their original resolution. JPEGs are saved byte for byte; other
            images are decoded to lossless PNG.
          </p>
          <OptionField label="Skip images smaller than" hint="Leaves out icons, bullets and spacer pixels.">
            <Segmented
              label="Skip images smaller than"
              value={minSize}
              options={[
                { value: 0, label: 'Keep all' },
                { value: 32, label: '32 px' },
                { value: 100, label: '100 px' },
              ]}
              onChange={setMinSize}
            />
          </OptionField>
          <SwitchRow
            id="ei-masks"
            label="Keep transparency"
            hint="Applies each image's transparency mask, saving it as a PNG with alpha."
            checked={applyMasks}
            onChange={setApplyMasks}
          />
          <SwitchRow
            id="ei-cmyk"
            label="Convert CMYK to RGB"
            hint="Print (CMYK) images display wrongly in most apps. Turn off to keep CMYK JPEGs exactly as stored."
            checked={cmykToRgb}
            onChange={setCmykToRgb}
          />
          <OptionField label="Password" htmlFor="ei-password" hint="Only for files that need a password to open.">
            <PasswordInput id="ei-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="pdf-images.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])}
      />
    </ToolFrame>
  );
}
