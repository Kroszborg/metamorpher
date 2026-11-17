'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { BODY_SIZE, type DocJobOptions, DocToPdfTool, docToPdfJob, prepareText } from '@/components/doc-tools';
import { OptionField } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Font = 'mono' | 'sans' | 'serif';
type Extra = { font: Font; tabSize: 2 | 4 | 8 };

const job = docToPdfJob<Extra & DocJobOptions>(({ file }, o) =>
  prepareText(file, { font: o.font, tabSize: o.tabSize, fontSize: BODY_SIZE[o.setup.textSize] - (o.font === 'mono' ? 0.5 : 0) }),
);

export default function TxtToPdf({ tool }: ToolProps) {
  const [font, setFont] = useState<Font>('mono');
  const [tabSize, setTabSize] = useState<Extra['tabSize']>(4);
  const extra = useMemo<Extra>(() => ({ font, tabSize }), [font, tabSize]);
  return (
    <DocToPdfTool
      accept={tool.accept}
      job={job}
      extra={extra}
      zipName="text-pdfs.zip"
      showOutline={false}
      paste={{ fileName: 'text.txt', type: 'text/plain', placeholder: 'Type or paste plain text here.' }}
      fields={
        <>
          <OptionField label="Typeface" hint="Monospace keeps columns of spaces lined up. Long lines wrap; form feeds start a new page.">
            <Segmented<Font>
              label="Typeface"
              value={font}
              options={[
                { value: 'mono', label: 'Monospace' },
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
              ]}
              onChange={setFont}
            />
          </OptionField>
          <OptionField label="Tab width">
            <Segmented<Extra['tabSize']>
              label="Tab width"
              value={tabSize}
              options={[
                { value: 2, label: '2' },
                { value: 4, label: '4' },
                { value: 8, label: '8' },
              ]}
              onChange={setTabSize}
            />
          </OptionField>
        </>
      }
    />
  );
}
