import type { ResultNote } from '@/components/pdf-tools';
import type { DocModel } from '@/engines/pdf-extract';
import type { PreparedHtml } from './html';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Notes about images left out while preparing HTML. */
export function imageNotes(p: PreparedHtml): ResultNote[] {
  const notes: ResultNote[] = [];
  if (p.remoteImages > 0) {
    notes.push({
      kind: 'warn',
      text: `${p.remoteImages === 1 ? '1 image is' : `${p.remoteImages} images are`} on the web and ${p.remoteImages === 1 ? 'was' : 'were'} left out: nothing is downloaded. Add the image files next to the document instead.`,
    });
  }
  if (p.missingImages.length > 0) {
    notes.push({
      kind: 'warn',
      text: `Images not found: ${p.missingImages.slice(0, 5).join(', ')}${p.missingImages.length > 5 ? '…' : ''}. Add them to the file list to include them.`,
    });
  }
  if (p.brokenImages > 0) notes.push({ kind: 'warn', text: `${plural(p.brokenImages, 'image')} could not be decoded and were left out.` });
  if (p.images > 0) notes.push({ kind: 'info', text: `${plural(p.images, 'image')} included.` });
  return notes;
}

/** Notes shared by the PDF → Word / HTML / EPUB tools. */
export function modelNotes(m: DocModel): ResultNote[] {
  const paras = m.blocks.filter((b) => b.kind === 'para');
  const headings = paras.filter((p) => p.kind === 'para' && p.level > 0).length;
  const notes: ResultNote[] = [
    { kind: 'ok', text: `${plural(m.pages, 'page')} → ${plural(paras.length, 'paragraph')}, ${plural(headings, 'heading')}, ${plural(m.tables, 'table')}, ${plural(m.images, 'image')}` },
  ];
  if (m.columnPages > 0) notes.push({ kind: 'info', text: `${plural(m.columnPages, 'page')} with several text columns read column by column.` });
  if (m.chars === 0) notes.push({ kind: 'warn', text: 'No text found: the pages are probably scanned images. Run text recognition (OCR) first; only the images were carried over.' });
  else if (m.scannedPages > 0) notes.push({ kind: 'warn', text: `${plural(m.scannedPages, 'page')} contain only images (scans?): their text was not recognised.` });
  return notes;
}
