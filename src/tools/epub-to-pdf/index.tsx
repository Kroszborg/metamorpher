'use client';

import { useMemo } from 'react';
import { BODY_SIZE, type DocJobOptions, DocToPdfTool, geometryOf, resultNotes } from '@/components/doc-tools';
import { NoteLine } from '@/components/pdf-tools';
import { type OutputFile, perFile } from '@/components/workbench';
import { typesetEngine } from '@/engines/typeset';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

const MAGIC: Record<string, string> = {
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook',
  mobi: 'application/x-mobipocket-ebook',
  xhtml: 'application/xhtml+xml',
};

// MuPDF reads and lays out the book itself (chapters, CSS, images, table of contents).
const job = perFile<DocJobOptions>(async ({ id, file }, o, ctx): Promise<OutputFile[]> => {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (ext === 'epub' && !(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('This file is not a valid EPUB (it is not a ZIP container).');
  const result = await typesetEngine.reflow(
    file,
    {
      page: geometryOf(o.setup),
      fontSize: BODY_SIZE[o.setup.textSize] + 0.5,
      outline: o.setup.outline,
      pageNumbers: o.setup.pageNumbers,
      magic: MAGIC[ext] ?? 'application/epub+zip',
      css: 'body{line-height:1.4}',
    },
    { signal: ctx.signal, onProgress: (done, _t, note) => ctx.onProgress(done, note) },
  );
  o.onReport(id, { notes: resultNotes(result, o.setup) });
  return [{ name: `${baseName(file.name)}.pdf`, blob: result.blob }];
});

export default function EpubToPdf({ tool }: ToolProps) {
  const extra = useMemo(() => ({}), []);
  return (
    <DocToPdfTool
      accept={tool.accept}
      job={job}
      extra={extra}
      zipName="ebook-pdfs.zip"
      imageResources={false}
      setupDefaults={{ size: 'a5', margin: 'narrow' }}
      textSizeHint="Books reflow to the page: a smaller page with larger text reads like a paperback."
      footer={
        <NoteLine
          note={{
            kind: 'info',
            text: 'Uses the book’s own styles, images and table of contents (as bookmarks). DRM-protected books cannot be converted.',
          }}
        />
      }
    />
  );
}
