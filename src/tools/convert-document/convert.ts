// HTML and Markdown output (mammoth for Word). PDF output goes through the
// same layout engine as the Markdown/HTML/Text/Word to PDF tools.
import { BODY_SIZE, prepareDocx, prepareHtmlFile, prepareMarkdown, prepareText } from '@/components/doc-tools';
import { pageGeometry, typesetEngine } from '@/engines/typeset';

export type PdfPageSize = 'a4' | 'letter' | 'legal';

export type DocumentConversionOptions = { pageSize?: PdfPageSize; signal?: AbortSignal; onProgress?: (fraction: number, note?: string) => void };

export type DocTarget = 'pdf' | 'html' | 'md';

/** Which targets each input extension supports. */
export const SUPPORTED: Record<string, readonly DocTarget[]> = {
  md: ['pdf', 'html'],
  markdown: ['pdf', 'html'],
  html: ['pdf'],
  htm: ['pdf'],
  txt: ['pdf'],
  docx: ['pdf', 'html', 'md'],
};

/** A standalone HTML document around a converted fragment, so it opens with the right encoding. */
function htmlDocument(title: string, body: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${safeTitle}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

export async function markdownToHtml(markdownFile: File): Promise<string> {
  const MarkdownIt = (await import('markdown-it')).default;
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  return md.render(await markdownFile.text());
}

export async function docxToHtml(docxFile: File): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ arrayBuffer: await docxFile.arrayBuffer() });
  return result.value;
}

/** Simplified DOCX → Markdown via HTML (mammoth has no direct Markdown output). */
export async function docxToMarkdown(docxFile: File): Promise<string> {
  const html = await docxToHtml(docxFile);
  const markdown = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/g, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/g, '#### $1\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/g, '##### $1\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/g, '###### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
    .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n');
  return markdown.trim();
}

/** Converts one file to `target`, or throws a message naming the unsupported pair. */
export async function convertDocument(
  file: File,
  ext: string,
  target: DocTarget,
  options: DocumentConversionOptions,
): Promise<Blob> {
  if (!SUPPORTED[ext]?.includes(target)) {
    throw new Error(`.${ext || '?'} files cannot be converted to ${target.toUpperCase()} here.`);
  }
  const title = file.name;
  if (target === 'pdf') {
    const size = BODY_SIZE.medium;
    const none = new Map<string, Blob>();
    const p =
      ext === 'txt'
        ? await prepareText(file, { fontSize: size - 0.5, font: 'mono', tabSize: 4 })
        : ext === 'html' || ext === 'htm'
          ? await prepareHtmlFile(file, { resources: none, fontSize: size, keepStyles: true })
          : ext === 'docx'
            ? await prepareDocx(file, { ownPage: false })
            : await prepareMarkdown(file, { resources: none, fontSize: size, font: 'sans' });
    const result = await typesetEngine.render(
      {
        blocks: p.blocks,
        css: p.css,
        page: p.page ?? pageGeometry(options.pageSize ?? 'a4', 'portrait', 'normal'),
        fontSize: p.fontSize,
        outline: true,
        pageNumbers: true,
        title: p.title ?? title,
        lang: p.lang,
      },
      { signal: options.signal, onProgress: (d, _t, n) => options.onProgress?.(d, n) },
    );
    return result.blob;
  }
  if (target === 'html') {
    const body = ext === 'docx' ? await docxToHtml(file) : await markdownToHtml(file);
    return new Blob([htmlDocument(title, body)], { type: 'text/html' });
  }
  return new Blob([await docxToMarkdown(file)], { type: 'text/markdown' });
}
