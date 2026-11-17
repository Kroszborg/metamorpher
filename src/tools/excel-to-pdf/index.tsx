'use client';

import { useMemo, useState } from 'react';
import { type DocJobOptions, DocToPdfTool, docToPdfJob, plural } from '@/components/doc-tools';
import { readWorkbook } from '@/components/doc-tools/sheets';
import { SwitchRow } from '@/components/pdf-stage';
import { NoteLine, type ResultNote } from '@/components/pdf-tools';
import { type Block, documentCss } from '@/engines/typeset';
import type { ToolProps } from '@/tools/types';

type Extra = { header: boolean; zebra: boolean; sheetNames: boolean };

const TABLE_SIZE = { small: 7.5, medium: 8.5, large: 10 } as const;

const job = docToPdfJob<Extra & DocJobOptions>(async ({ file }, o) => {
  const book = await readWorkbook(await file.arrayBuffer(), { header: o.header, name: file.name });
  const blocks: Block[] = [];
  book.sheets.forEach((s, i) => {
    if (i > 0) blocks.push({ kind: 'page-break' });
    blocks.push({
      kind: 'table',
      title: o.sheetNames || book.sheets.length > 1 ? s.name : undefined,
      header: s.header,
      rows: s.rows,
      align: s.align,
      repeatHeader: true,
      zebra: o.zebra,
    });
  });
  const size = TABLE_SIZE[o.setup.textSize];
  const notes: ResultNote[] = [
    {
      kind: 'info',
      text: book.sheets.map((s) => `${s.name}: ${plural(s.rows.length + (s.header ? 1 : 0), 'row')} × ${plural(s.align.length, 'column')}`).join(' · '),
    },
  ];
  const hidden = book.sheets.reduce((n, s) => n + s.hiddenRows + s.hiddenCols, 0);
  const skipped = [...book.skipped, ...(hidden ? [`${hidden} hidden rows/columns`] : [])];
  if (skipped.length) notes.push({ kind: 'info', text: `Left out: ${skipped.join(', ')}.` });
  return {
    blocks,
    css: documentCss({ fontSize: size, font: 'sans', lineHeight: 1.3 }),
    fontSize: size,
    title: book.title,
    notes,
  };
});

export default function ExcelToPdf({ tool }: ToolProps) {
  const [header, setHeader] = useState(true);
  const [zebra, setZebra] = useState(false);
  const [sheetNames, setSheetNames] = useState(true);
  const extra = useMemo<Extra>(() => ({ header, zebra, sheetNames }), [header, zebra, sheetNames]);
  return (
    <DocToPdfTool
      accept={tool.accept}
      job={job}
      extra={extra}
      zipName="spreadsheet-pdfs.zip"
      allowAuto
      imageResources={false}
      setupDefaults={{ orientation: 'auto', margin: 'narrow' }}
      fields={
        <>
          <SwitchRow
            id="xl-header"
            label="First row is the header"
            hint="Repeated at the top of every page of its sheet."
            checked={header}
            onChange={setHeader}
          />
          <SwitchRow id="xl-zebra" label="Shade alternate rows" checked={zebra} onChange={setZebra} />
          <SwitchRow id="xl-names" label="Sheet names as titles" hint="Each sheet starts on a new page and gets a bookmark." checked={sheetNames} onChange={setSheetNames} />
        </>
      }
      footer={
        <NoteLine
          note={{
            kind: 'info',
            text: 'Cell values are shown as Excel formats them (numbers, dates, currencies), in a clean table. Cell colours, fonts, charts, images and print areas are not reproduced; hidden rows, columns and sheets are left out.',
          }}
        />
      }
    />
  );
}
