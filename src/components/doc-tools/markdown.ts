/** Markdown → HTML (CommonMark + GitHub tables, strikethrough, task lists, heading anchors). */

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** YAML or TOML front matter at the very top: not part of the document body. */
export function stripFrontMatter(text: string): { body: string; title?: string } {
  const m = /^(?:﻿)?(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { body: text };
  const title = /^title\s*[:=]\s*["']?(.+?)["']?\s*$/m.exec(m[2] as string)?.[1];
  return { body: text.slice(m[0].length), title };
}

export async function markdownToHtml(source: string): Promise<{ html: string; title?: string }> {
  const MarkdownIt = (await import('markdown-it')).default;
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false });
  // GitHub-style ids on headings, so [links](#a-heading) resolve inside the PDF.
  md.core.ruler.push('heading_ids', (state) => {
    const seen = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t?.type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const base = slugify(inline?.content ?? '') || 'section';
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      t.attrSet('id', n === 0 ? base : `${base}-${n}`);
    }
  });
  const { body, title } = stripFrontMatter(source);
  let html = md.render(body);
  // Task lists: "- [ ] todo" / "- [x] done".
  html = html.replace(/<li>(\s*<p>)?\s*\[([ xX])\]\s+/g, (_m, p: string | undefined, mark: string) => {
    const box = mark === ' ' ? '☐' : '☑';
    return `<li class="task">${p ?? ''}${box} `;
  });
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/
    .exec(html)?.[1]
    ?.replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? '')
    .trim();
  return { html, title: title ?? (h1 || undefined) };
}
