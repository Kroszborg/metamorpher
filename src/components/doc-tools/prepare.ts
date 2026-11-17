/**
 * Input → layout-engine blocks for each document type. The tools (Markdown,
 * HTML, text, Word to PDF) and Convert document share these.
 */
import type { ResultNote } from '@/components/pdf-tools';
import { type Block, documentCss } from '@/engines/typeset';
import { docxToHtml } from './docx';
import { prepareHtml } from './html';
import type { Resources } from './images';
import type { Prepared } from './job';
import { markdownToHtml } from './markdown';
import { decodeText, looksBinary } from './text';
import { imageNotes, plural } from './notes';

function encodingNote(encoding: string): ResultNote[] {
  return encoding !== 'UTF-8' ? [{ kind: 'info', text: `Read as ${encoding}.` }] : [];
}

export async function prepareMarkdown(
  file: Blob,
  o: { resources: Resources; fontSize: number; font: 'sans' | 'serif' },
): Promise<Prepared> {
  const { text, encoding } = await decodeText(file);
  if (looksBinary(text)) throw new Error('This does not look like a Markdown or text file.');
  const md = await markdownToHtml(text);
  const html = await prepareHtml(md.html, { resources: o.resources, keepStyles: true });
  return {
    blocks: [{ kind: 'html', html: html.body }],
    css: `${documentCss({ fontSize: o.fontSize, font: o.font })}\n${html.css}`,
    fontSize: o.fontSize,
    title: md.title,
    notes: [...imageNotes(html), ...encodingNote(encoding)],
  };
}

export async function prepareHtmlFile(
  file: Blob,
  o: { resources: Resources; fontSize: number; keepStyles: boolean },
): Promise<Prepared> {
  const { text, encoding } = await decodeText(file);
  if (looksBinary(text)) throw new Error('This does not look like an HTML file.');
  const html = await prepareHtml(text, { resources: o.resources, keepStyles: o.keepStyles });
  if (!html.body.replace(/<[^>]+>/g, '').trim() && !/<img/i.test(html.body)) throw new Error('This HTML file has no visible content.');
  return {
    blocks: [{ kind: 'html', html: html.body }],
    // The page's own CSS goes after the base style, so it wins where it says something.
    css: `${documentCss({ fontSize: o.fontSize, font: 'sans' })}\n${o.keepStyles ? html.css : ''}`,
    fontSize: o.fontSize,
    title: html.title,
    lang: html.lang,
    notes: [...imageNotes(html), ...encodingNote(encoding)],
  };
}

function escape(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export async function prepareText(
  file: Blob,
  o: { fontSize: number; font: 'mono' | 'sans' | 'serif'; tabSize: number },
): Promise<Prepared> {
  const { text, encoding } = await decodeText(file);
  if (looksBinary(text)) throw new Error('This does not look like a text file.');
  const normal = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' '.repeat(o.tabSize));
  const blocks: Block[] = [];
  // A form feed starts a new page, as on a printer.
  normal.split('\f').forEach((page, i) => {
    if (i > 0) blocks.push({ kind: 'page-break' });
    // Very long files: several blocks, so no single paragraph holds megabytes.
    const lines = page.split('\n');
    for (let start = 0; start < lines.length; start += 2000) {
      const chunk = lines.slice(start, start + 2000).join('\n');
      blocks.push({ kind: 'html', html: `<div class="txt">${escape(chunk) || '&#160;'}</div>` });
    }
  });
  const family = o.font === 'mono' ? 'monospace' : o.font === 'serif' ? 'serif' : 'sans-serif';
  return {
    blocks,
    css: `body{font-family:${family};font-size:${o.fontSize}pt;line-height:1.4;color:#1f2328;margin:0}
.txt{font-family:${family};white-space:pre-wrap;margin:0;padding:0}`,
    fontSize: o.fontSize,
    notes: encodingNote(encoding),
  };
}

export async function prepareDocx(file: File, o: { ownPage: boolean }): Promise<Prepared> {
  if (/\.doc$/i.test(file.name)) throw new Error('Old .doc files are not supported. Save the document as .docx in Word or LibreOffice first.');
  const doc = await docxToHtml(await file.arrayBuffer());
  const notes: ResultNote[] = [];
  if (doc.images > 0) notes.push({ kind: 'info', text: `${plural(doc.images, 'image')} included${doc.metafiles > 0 ? ` (${plural(doc.metafiles, 'EMF/WMF picture')} drawn from the bitmap inside)` : ''}.` });
  const running = [doc.header ? 'headers' : '', doc.footer ? 'footers' : '', doc.footnotes.length > 0 ? `${plural(doc.footnotes.length, 'footnote')} at the bottom of their pages` : ''].filter(Boolean);
  if (running.length > 0 && (o.ownPage || doc.footnotes.length > 0)) notes.push({ kind: 'info', text: `Drawn: ${running.join(', ')}.` });
  if (doc.skipped.length > 0) notes.push({ kind: 'warn', text: `Not reproduced: ${doc.skipped.join(', ')}.` });
  notes.push({ kind: 'info', text: 'Layout is approximated from the document; line and page breaks can differ from Word.' });
  return {
    blocks: [{ kind: 'html', html: doc.html }],
    css: doc.css,
    fontSize: doc.defaultSize,
    title: doc.title,
    lang: doc.lang,
    page: o.ownPage && doc.page ? doc.page : undefined,
    // Headers and footers sit in the document's own margins.
    header: o.ownPage && doc.page ? doc.header : undefined,
    footer: o.ownPage && doc.page ? doc.footer : undefined,
    footnotes: doc.footnotes,
    notes,
  };
}
