/** A document model (from a PDF) → HTML / XHTML and EPUB. */
import { strToU8, zipSync } from 'fflate';
import type { DocBlock, DocModel, DocTable, Para, Run } from '@/engines/pdf-extract';
import { xmlText } from './docx-writer';

export const READER_CSS = `body{font-family:Georgia,'Times New Roman',serif;line-height:1.55;color:#1f2328;max-width:46em;margin:0 auto;padding:2em 1.2em}
h1,h2,h3,h4{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.25;margin:1.4em 0 0.5em}
p{margin:0 0 0.8em}
p.center{text-align:center}p.right{text-align:right}p.justify{text-align:justify}
p.item{padding-left:1.4em;text-indent:-1.2em}
img{max-width:100%;height:auto;display:block;margin:0.8em auto}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.9em}
hr.page{border:none;border-top:1px dashed #d0d7de;margin:2em 0}
a{color:#0969da}
table{border-collapse:collapse;margin:0.8em 0 1.2em;font-size:0.92em;max-width:100%}
th,td{border:1px solid #c8ccd1;padding:0.3em 0.55em;text-align:left;vertical-align:top}
th{background:#f2f4f7}`;

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function runHtml(r: Run, bodySize: number, heading: boolean): string {
  let t = xmlText(r.text);
  if (!t) return '';
  if (r.mono) t = `<code>${t}</code>`;
  if (r.bold && !heading) t = `<strong>${t}</strong>`;
  if (r.italic) t = `<em>${t}</em>`;
  const style: string[] = [];
  if (r.color && r.color !== '#000000' && !/^#(1|2|3)\w{5}$/.test(r.color)) style.push(`color:${r.color}`);
  if (!heading && Math.abs(r.size - bodySize) > bodySize * 0.12) style.push(`font-size:${(r.size / bodySize).toFixed(2)}em`);
  if (style.length) t = `<span style="${style.join(';')}">${t}</span>`;
  if (r.link) {
    const href = r.link.startsWith('www.') ? `https://${r.link}` : r.link;
    if (/^(https?:|mailto:)/i.test(href)) t = `<a href="${xmlText(href)}">${t}</a>`;
  }
  return t;
}

function paraHtml(p: Para, bodySize: number): string {
  const heading = p.level > 0;
  const inner = p.runs.map((r) => runHtml(r, bodySize, heading)).join('');
  if (!inner.trim()) return '';
  if (heading) return `<h${p.level}>${inner}</h${p.level}>`;
  const cls = [p.align !== 'left' ? p.align : '', p.list ? 'item' : ''].filter(Boolean).join(' ');
  const indent = p.indent > 12 && p.align === 'left' && !p.list ? ` style="margin-left:${Math.round(p.indent)}pt"` : '';
  return `<p${cls ? ` class="${cls}"` : ''}${indent}>${inner}</p>`;
}

function tableHtml(t: DocTable): string {
  const rows = t.rows.map((row, r) => {
    const tag = r === 0 && t.header ? 'th' : 'td';
    const cells = row.map((c) => {
      const text = xmlText(c.text);
      const inner = c.bold && tag === 'td' ? `<strong>${text}</strong>` : text;
      return `<${tag}${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''}>${inner}</${tag}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  const head = t.header && rows.length > 1 ? `<thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody>` : `<tbody>${rows.join('')}</tbody>`;
  return `<table>${head}</table>`;
}

/** Blocks → XHTML-safe markup. `image(i, block)` returns the src for an image. */
export function blocksHtml(blocks: DocBlock[], bodySize: number, image: (n: number, b: Extract<DocBlock, { kind: 'image' }>) => string, pageRules: boolean): string {
  let n = 0;
  return blocks
    .map((b) => {
      if (b.kind === 'page-break') return pageRules ? '<hr class="page"/>' : '';
      if (b.kind === 'para') return paraHtml(b, bodySize);
      if (b.kind === 'table') return tableHtml(b);
      n += 1;
      return `<img src="${image(n, b)}" alt="" width="${Math.round(b.width * (4 / 3))}"/>`;
    })
    .filter(Boolean)
    .join('\n');
}

/** One self-contained HTML file: images embedded as data: URLs. */
export function modelToHtml(model: DocModel, { pageRules }: { pageRules: boolean }): string {
  const body = blocksHtml(model.blocks, model.bodySize, (_n, b) => `data:${b.mime};base64,${base64(b.bytes)}`, pageRules);
  const title = xmlText(model.title ?? 'Document');
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1"/>\n<title>${title}</title>\n<style>${READER_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** EPUB 3 with chapters at the top heading level, a table of contents and the images. */
export function modelToEpub(model: DocModel, { name }: { name: string }): Blob {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const images: { id: string; href: string; mime: string }[] = [];
  const imageSrc = (n: number, b: Extract<DocBlock, { kind: 'image' }>) => {
    const href = `images/img${n}.${b.mime === 'image/png' ? 'png' : 'jpg'}`;
    files[`OEBPS/${href}`] = b.bytes;
    images.push({ id: `img${n}`, href, mime: b.mime });
    return href;
  };
  // Chapters: split before each heading of the top level that has at least two headings.
  const blocks = model.blocks.filter((b) => b.kind !== 'page-break');
  const levels = [1, 2, 3].filter((l) => blocks.filter((b) => b.kind === 'para' && b.level === l).length >= 2);
  const splitLevel = levels[0];
  const chapters: { title: string; blocks: DocBlock[] }[] = [];
  let current: { title: string; blocks: DocBlock[] } = { title: model.title ?? name, blocks: [] };
  for (const b of blocks) {
    if (splitLevel && b.kind === 'para' && b.level === splitLevel && current.blocks.length > 0) {
      chapters.push(current);
      current = { title: '', blocks: [] };
    }
    if (!current.title && b.kind === 'para' && b.level > 0) current.title = b.runs.map((r) => r.text).join('').trim();
    current.blocks.push(b);
  }
  chapters.push(current);
  // Global image numbering across chapters.
  let counter = 0;
  const chapterFiles = chapters.map((c, i) => {
    const body = blocksHtml(c.blocks, model.bodySize, (_n, b) => imageSrc(++counter, b), false);
    const title = xmlText(c.title || `Part ${i + 1}`);
    files[`OEBPS/ch${i + 1}.xhtml`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>\n${body}\n</body></html>`);
    return { href: `ch${i + 1}.xhtml`, title };
  });
  const bookTitle = xmlText(model.title ?? name);
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  files['OEBPS/style.css'] = strToU8(READER_CSS.replace('max-width:46em;margin:0 auto;padding:2em 1.2em', 'margin:0;padding:0'));
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapterFiles.map((c) => `<li><a href="${c.href}">${c.title}</a></li>`).join('')}</ol></nav></body></html>`);
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${bookTitle}</dc:title><dc:language>en</dc:language>${model.author ? `<dc:creator>${xmlText(model.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chapterFiles.map((c, i) => `<item id="ch${i + 1}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('')}${images.map((im) => `<item id="${im.id}" href="${im.href}" media-type="${im.mime}"/>`).join('')}</manifest><spine>${chapterFiles.map((_c, i) => `<itemref idref="ch${i + 1}"/>`).join('')}</spine></package>`);
  // mimetype must be the first entry, stored uncompressed.
  const ordered: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { mimetype: files.mimetype };
  for (const [k, v] of Object.entries(files)) if (k !== 'mimetype') ordered[k] = v;
  return new Blob([zipSync(ordered, { level: 6 })], { type: 'application/epub+zip' });
}
