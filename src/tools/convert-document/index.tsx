'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, Workbench } from '@/components/workbench';
import { extensionOf, replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { convertDocument, type DocTarget, type PdfPageSize, SUPPORTED } from './convert';

type Options = { target: DocTarget; pageSize: PdfPageSize };

// Reading runs on the main thread (DOM parser); PDF layout runs in the typeset worker.
const job = perFile<Options>(async ({ file }, { target, pageSize }, ctx) => {
  ctx.onProgress(0.05);
  const blob = await convertDocument(file, extensionOf(file.name), target, { pageSize, signal: ctx.signal, onProgress: ctx.onProgress });
  return { name: replaceExtension(file.name, target), blob };
});

const HINT: Record<DocTarget, string> = {
  pdf: 'From Markdown, HTML, TXT and DOCX, with headings, tables, images and selectable text. The dedicated Markdown, HTML, Text and Word to PDF tools have more options.',
  html: 'From Markdown and DOCX.',
  md: 'From DOCX. Headings, bold and italics are kept.',
};

export default function ConvertDocument({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ target: 'pdf', pageSize: 'a4' });

  return (
    <Workbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Convert"
      zipName="converted-documents.zip"
      validate={(files, o) =>
        files.some((f) => SUPPORTED[extensionOf(f.file.name)]?.includes(o.target))
          ? null
          : `None of these files can be converted to ${o.target.toUpperCase()}.`
      }
      optionsPanel={
        <>
          <OptionField label="Convert to" hint={HINT[options.target]}>
            <Segmented
              label="Output format"
              value={options.target}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'html', label: 'HTML' },
                { value: 'md', label: 'Markdown' },
              ]}
              onChange={(target) => setOptions((o) => ({ ...o, target }))}
            />
          </OptionField>
          {options.target === 'pdf' ? (
            <OptionField label="Page size">
              <Segmented
                label="Page size"
                value={options.pageSize}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                  { value: 'legal', label: 'Legal' },
                ]}
                onChange={(pageSize) => setOptions((o) => ({ ...o, pageSize }))}
              />
            </OptionField>
          ) : null}
        </>
      }
    />
  );
}
