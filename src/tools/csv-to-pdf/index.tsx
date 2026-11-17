'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import {
  columnAlignment,
  decodeText,
  type DocJobOptions,
  DocToPdfTool,
  docToPdfJob,
  looksBinary,
  parseCsv,
  plural,
} from '@/components/doc-tools';
import { SwitchRow } from '@/components/pdf-stage';
import { OptionField } from '@/components/workbench';
import { documentCss } from '@/engines/typeset';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Delim = 'auto' | ',' | ';' | '\t' | '|';
type Extra = { header: boolean; zebra: boolean; title: boolean; delimiter: Delim };

const TABLE_SIZE = { small: 7.5, medium: 8.5, large: 10 } as const;

const job = docToPdfJob<Extra & DocJobOptions>(async ({ file }, o) => {
  const { text, encoding } = await decodeText(file);
  if (looksBinary(text)) throw new Error('This does not look like a CSV or text file.');
  const rows = o.delimiter === 'auto' ? parseCsv(text) : parseCsv(text, o.delimiter);
  if (rows.length === 0) throw new Error('This file has no rows.');
  const columns = Math.max(...rows.map((r) => r.length));
  const header = o.header ? (rows[0] as string[]) : null;
  const body = o.header ? rows.slice(1) : rows;
  const size = TABLE_SIZE[o.setup.textSize];
  return {
    blocks: [
      {
        kind: 'table',
        title: o.title ? file.name : undefined,
        header: header ? [...header, ...new Array<string>(columns - header.length).fill('')] : null,
        rows: body,
        align: columnAlignment(body, columns),
        repeatHeader: true,
        zebra: o.zebra,
      },
    ],
    css: documentCss({ fontSize: size, font: 'sans', lineHeight: 1.3 }),
    fontSize: size,
    title: baseName(file.name),
    notes: [
      { kind: 'info', text: `${plural(body.length, 'row')} × ${plural(columns, 'column')}${encoding !== 'UTF-8' ? ` · read as ${encoding}` : ''}` },
    ],
  };
});

export default function CsvToPdf({ tool }: ToolProps) {
  const [header, setHeader] = useState(true);
  const [zebra, setZebra] = useState(true);
  const [title, setTitle] = useState(true);
  const [delimiter, setDelimiter] = useState<Delim>('auto');
  const extra = useMemo<Extra>(() => ({ header, zebra, title, delimiter }), [header, zebra, title, delimiter]);
  return (
    <DocToPdfTool
      accept={[...tool.accept, '.tsv', 'text/tab-separated-values']}
      job={job}
      extra={extra}
      zipName="csv-pdfs.zip"
      allowAuto
      showOutline={false}
      setupDefaults={{ orientation: 'auto', margin: 'narrow' }}
      paste={{ fileName: 'data.csv', type: 'text/csv', placeholder: 'name,amount\nAlice,12.50\nBob,8' }}
      fields={
        <>
          <OptionField label="Separator">
            <Segmented<Delim>
              label="Separator"
              value={delimiter}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: ',', label: ',' },
                { value: ';', label: ';' },
                { value: '\t', label: 'Tab' },
                { value: '|', label: '|' },
              ]}
              onChange={setDelimiter}
            />
          </OptionField>
          <SwitchRow
            id="csv-header"
            label="First row is the header"
            hint="Repeated at the top of every page."
            checked={header}
            onChange={setHeader}
          />
          <SwitchRow id="csv-zebra" label="Shade alternate rows" checked={zebra} onChange={setZebra} />
          <SwitchRow id="csv-title" label="File name as title" checked={title} onChange={setTitle} />
        </>
      }
    />
  );
}
