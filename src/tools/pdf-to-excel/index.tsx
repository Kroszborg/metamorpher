'use client';

import { useCallback, useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { plural } from '@/components/doc-tools';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, NoteLine, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { type CellValue, detectTable, pdfExtract } from '@/engines/pdf-extract';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Sheets = 'page' | 'one';
type Options = {
  sheets: Sheets;
  numbers: boolean;
  password: string;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const job = perFile<Options>(async (input, o, ctx) => {
  const pages = await pdfExtract.words(input.file, {
    password: o.password || undefined,
    signal: ctx.signal,
    onProgress: (d, t, n) => ctx.onProgress((d / Math.max(1, t)) * 0.85, n),
  });
  const words = pages.reduce((n, p) => n + p.words.length, 0);
  if (words === 0) throw new Error('This PDF has no text to put in cells (scanned pages need text recognition first).');
  ctx.onProgress(0.9, 'Finding tables');
  const tables = pages.map((p) => detectTable(p, { numbers: o.numbers }));
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const sheetOf = (rows: CellValue[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const cols = Math.max(0, ...rows.map((r) => r.length));
    ws['!cols'] = Array.from({ length: cols }, (_, c) => ({
      wch: Math.min(60, Math.max(6, ...rows.slice(0, 2000).map((r) => String(r[c] ?? '').length + 1))),
    }));
    return ws;
  };
  if (o.sheets === 'page') {
    tables.forEach((t, i) => {
      if (t.rows.length) XLSX.utils.book_append_sheet(wb, sheetOf(t.rows), `Page ${i + 1}`);
    });
  } else {
    // One sheet: a header row repeated at the top of later pages is kept once.
    const all: CellValue[][] = [];
    const headers = new Set<string>();
    tables.forEach((t) => {
      const head = t.rows.find((r) => r.filter((v) => v !== '').length >= 2);
      const key = head ? JSON.stringify(head) : null;
      for (const r of t.rows) if (!(r === head && key && headers.has(key))) all.push(r);
      if (key) headers.add(key);
    });
    XLSX.utils.book_append_sheet(wb, sheetOf(all), 'Tables');
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  const rows = tables.reduce((n, t) => n + t.rows.length, 0);
  const numeric = tables.reduce((n, t) => n + t.rows.reduce((k, r) => k + r.filter((v) => typeof v === 'number').length, 0), 0);
  const maxCols = Math.max(...tables.map((t) => t.columns));
  const notes: ResultNote[] = [
    { kind: 'ok', text: `${plural(pages.length, 'page')} → ${plural(rows, 'row')}, up to ${plural(maxCols, 'column')}, ${plural(numeric, 'number')} as numeric cells` },
  ];
  const plain = tables.filter((t) => t.tabularRows === 0).length;
  if (plain > 0) notes.push({ kind: 'info', text: `${plural(plain, 'page')} had no columns (plain text): one line per row in the first column.` });
  o.onReport(input.id, notes);
  return { name: `${baseName(input.file.name)}.xlsx`, blob: new Blob([bytes], { type: XLSX_TYPE }) };
});

export default function PdfToExcel({ tool }: ToolProps) {
  const [sheets, setSheets] = useState<Sheets>('page');
  const [numbers, setNumbers] = useState(true);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ sheets, numbers, password, onReport }), [sheets, numbers, password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to Excel"
      optionsPanel={
        <>
          <OptionField label="Sheets">
            <Segmented<Sheets>
              label="Sheets"
              value={sheets}
              options={[
                { value: 'page', label: 'One per page' },
                { value: 'one', label: 'All in one sheet' },
              ]}
              onChange={setSheets}
            />
          </OptionField>
          <SwitchRow
            id="px-numbers"
            label="Numbers as numbers"
            hint="1,234.56, (12), 45% and $9.99 become numeric cells you can sum. Codes with leading zeros stay text."
            checked={numbers}
            onChange={setNumbers}
          />
          <OptionField label="Password" htmlFor="px-password" hint="Only for files that need a password to open.">
            <PasswordInput id="px-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <NoteLine
            note={{
              kind: 'info',
              text: 'Cells come from the ruling lines of a table when it has them, otherwise from how the text lines up, so it works best on PDFs exported from spreadsheets or reports. Text that wraps over several lines inside a cell is joined back into one cell. Scanned pages need text recognition first. Check the result before relying on it.',
            }}
          />
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="spreadsheets.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
