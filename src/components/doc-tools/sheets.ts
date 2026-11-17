/** Spreadsheets (XLSX, XLS, ODS, CSV) → tables, read with SheetJS Community Edition (Apache-2.0). */

export type SheetTable = {
  name: string;
  header: string[] | null;
  rows: string[][];
  align: ('left' | 'right' | 'center')[];
  hiddenRows: number;
  hiddenCols: number;
};

export type Workbook = { sheets: SheetTable[]; skipped: string[]; title?: string };

export async function readWorkbook(data: ArrayBuffer, { header, name }: { header: boolean; name: string }): Promise<Workbook> {
  // SheetJS reads almost anything as a one-column text sheet; check the container first.
  const head = new Uint8Array(data.slice(0, 8));
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if ((ext === 'xlsx' || ext === 'xlsm' || ext === 'ods') && !zip) throw new Error(`This file is not a valid .${ext} spreadsheet.`);
  if (ext === 'xls' && !ole && !zip) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data.slice(0, 4096));
    // Some ".xls" files are really HTML or text tables; random bytes are not.
    if (!/<(table|html)|[\t,;]/i.test(text) || (text.match(/�/g)?.length ?? 0) > 20) throw new Error('This file is not a valid .xls spreadsheet.');
  }
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true, cellNF: true, cellStyles: false, dense: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(msg)) throw new Error('This workbook is password-protected. Remove the password in Excel first.');
    throw new Error(`This file could not be read as a spreadsheet (${msg}).`);
  }
  if (!wb.SheetNames?.length) throw new Error('This file has no sheets.');
  const sheets: SheetTable[] = [];
  const skipped: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const hiddenSheet = wb.Workbook?.Sheets?.find((s) => s.name === name)?.Hidden;
    if (hiddenSheet) {
      skipped.push(`hidden sheet “${name}”`);
      continue;
    }
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rowsMeta = ws['!rows'] ?? [];
    const colsMeta = ws['!cols'] ?? [];
    const cols: number[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) if (!colsMeta[c]?.hidden) cols.push(c);
    const grid: string[][] = [];
    const numeric = new Array<number>(cols.length).fill(0);
    const filled = new Array<number>(cols.length).fill(0);
    let hiddenRows = 0;
    const dense = (ws as unknown as { '!data'?: (import('xlsx').CellObject | undefined)[][] })['!data'];
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (rowsMeta[r]?.hidden) {
        hiddenRows += 1;
        continue;
      }
      const row: string[] = [];
      cols.forEach((c, i) => {
        const cell = dense ? dense[r]?.[c] : (ws[XLSX.utils.encode_cell({ r, c })] as import('xlsx').CellObject | undefined);
        if (!cell || cell.t === 'z') {
          row.push('');
          return;
        }
        let text: string;
        try {
          text = cell.w ?? XLSX.utils.format_cell(cell);
        } catch {
          text = cell.v === undefined || cell.v === null ? '' : String(cell.v);
        }
        if (cell.t === 'd' && !cell.w && cell.v instanceof Date) text = cell.v.toLocaleDateString();
        row.push(text);
        if (text.trim()) {
          filled[i] = (filled[i] as number) + 1;
          if (cell.t === 'n') numeric[i] = (numeric[i] as number) + 1;
        }
      });
      grid.push(row);
    }
    // Drop trailing empty rows and columns (formatting-only cells stretch the used range).
    while (grid.length && (grid[grid.length - 1] as string[]).every((v) => !v.trim())) grid.pop();
    let width = cols.length;
    while (width > 0 && grid.every((row) => !(row[width - 1] ?? '').trim())) width -= 1;
    if (grid.length === 0 || width === 0) {
      skipped.push(`empty sheet “${name}”`);
      continue;
    }
    const trimmed = grid.map((row) => row.slice(0, width));
    const align = numeric.slice(0, width).map((n, i) => ((filled[i] as number) > 0 && n / (filled[i] as number) >= 0.6 ? 'right' : 'left') as 'left' | 'right');
    sheets.push({
      name,
      header: header ? (trimmed[0] as string[]) : null,
      rows: header ? trimmed.slice(1) : trimmed,
      align,
      hiddenRows,
      hiddenCols: range.e.c - range.s.c + 1 - cols.length,
    });
  }
  if (sheets.length === 0) throw new Error('This workbook has no visible data.');
  return { sheets, skipped, title: wb.Props?.Title || undefined };
}
