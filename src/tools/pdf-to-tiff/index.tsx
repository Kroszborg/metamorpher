'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineNote, PasswordInput } from '@/components/pdf-tools';
import { OptionField, perFile, Workbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, mupdfEngine, type TiffOptions } from '@/engines/mupdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { dpi: number; color: TiffOptions['color']; password: string };

const job = perFile<Options>(async ({ file }, o, ctx) => {
  const blob = await mupdfEngine.toTiff(
    file,
    { dpi: o.dpi, color: o.color },
    {
      signal: ctx.signal,
      password: o.password || undefined,
      onProgress: (done, total) => ctx.onProgress(done / Math.max(1, total), `Page ${Math.min(done + 1, total)} of ${total}`),
    },
  );
  return { name: `${baseName(file.name)}.tiff`, blob };
});

export default function PdfToTiff({ tool }: ToolProps) {
  const [dpi, setDpi] = useState(200);
  const [color, setColor] = useState<TiffOptions['color']>('rgb');
  const [password, setPassword] = useState('');
  const options = useMemo<Options>(() => ({ dpi, color, password }), [dpi, color, password]);

  return (
    <Workbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Convert to TIFF"
      zipName="tiff.zip"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            All pages go into one multi-page TIFF, compressed losslessly (Deflate).
          </p>
          <OptionField label="Resolution">
            <Segmented
              label="Resolution"
              value={dpi}
              options={[
                { value: 100, label: '100 dpi' },
                { value: 200, label: '200 dpi' },
                { value: 300, label: '300 dpi' },
              ]}
              onChange={setDpi}
            />
          </OptionField>
          <OptionField label="Colour" hint={color === 'bw' ? 'One bit per pixel, like a fax or archive scan.' : undefined}>
            <Segmented<TiffOptions['color']>
              label="Colour"
              value={color}
              options={[
                { value: 'rgb', label: 'Colour' },
                { value: 'gray', label: 'Greyscale' },
                { value: 'bw', label: 'Black & white' },
              ]}
              onChange={setColor}
            />
          </OptionField>
          <OptionField label="Password" htmlFor="tf-password" hint="Only for files that need a password to open.">
            <PasswordInput id="tf-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    />
  );
}
