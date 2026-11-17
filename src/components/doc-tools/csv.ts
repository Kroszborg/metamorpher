/** CSV / TSV reading: delimiter detection, quoted fields with commas, quotes and line breaks. */

export type Delimiter = ',' | ';' | '\t' | '|';
const CANDIDATES: Delimiter[] = [',', ';', '\t', '|'];

/** The delimiter that splits the first lines into the most consistent number of fields. */
export function detectDelimiter(text: string): Delimiter {
  const lines: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < text.length && lines.length < 30; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === '\n' && !inQuotes) {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (lines.length < 30 && start < text.length) lines.push(text.slice(start));
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.filter((l) => l.trim() !== '').map((l) => l.replace(/"[^"]*"/g, '').split(d).length - 1);
    if (counts.length === 0) continue;
    const first = counts[0] as number;
    if (first === 0) continue;
    const same = counts.filter((n) => n === first).length;
    const score = (same / counts.length) * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 parsing (plus lenient handling of stray quotes). Empty trailing lines are dropped. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const c = text[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length > 0 && (rows[rows.length - 1] as string[]).every((f) => f.trim() === '')) rows.pop();
  return rows;
}

const NUMBER = /^[-+(]?\s?[$€£¥₹]?\s?\d[\d,.\s']*\s?%?\)?$|^[-+]?\d*\.\d+(e[-+]?\d+)?$/i;

/** Right-align columns that are mostly numbers. */
export function columnAlignment(rows: readonly (readonly string[])[], columns: number): ('left' | 'right')[] {
  const numeric = new Array<number>(columns).fill(0);
  const filled = new Array<number>(columns).fill(0);
  const step = rows.length > 2000 ? Math.ceil(rows.length / 2000) : 1;
  for (let r = 0; r < rows.length; r += step) {
    const row = rows[r] as readonly string[];
    for (let c = 0; c < columns; c++) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled[c] = (filled[c] as number) + 1;
      if (NUMBER.test(v)) numeric[c] = (numeric[c] as number) + 1;
    }
  }
  return numeric.map((n, c) => ((filled[c] as number) > 0 && n / (filled[c] as number) >= 0.8 ? 'right' : 'left'));
}
