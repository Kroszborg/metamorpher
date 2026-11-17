'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { NoteLine } from '@/components/pdf-tools';
import { OptionField } from '@/components/workbench';
import { BODY_SIZE, type DocJobOptions, DocToPdfTool, docToPdfJob, prepareMarkdown } from '@/components/doc-tools';
import type { ToolProps } from '@/tools/types';

type Font = 'sans' | 'serif';
type Extra = { font: Font };

const job = docToPdfJob<Extra & DocJobOptions>(({ file }, o) =>
  prepareMarkdown(file, { resources: o.resources, fontSize: BODY_SIZE[o.setup.textSize], font: o.font }),
);

export default function MarkdownToPdf({ tool }: ToolProps) {
  const [font, setFont] = useState<Font>('sans');
  const extra = useMemo<Extra>(() => ({ font }), [font]);
  return (
    <DocToPdfTool
      accept={[...tool.accept, 'image/*', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']}
      job={job}
      extra={extra}
      zipName="markdown-pdfs.zip"
      paste={{
        fileName: 'document.md',
        type: 'text/markdown',
        placeholder: '# Title\n\nWrite or paste **Markdown** here: lists, tables, `code`, images…',
      }}
      fields={
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
      }
      footer={
        <NoteLine
          note={{
            kind: 'info',
            text: 'Images: add the image files next to the .md file (matched by name), or embed them as data: URLs. Images on the web are never downloaded.',
          }}
        />
      }
    />
  );
}
