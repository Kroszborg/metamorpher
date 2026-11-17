/**
 * Résumé → HTML + CSS for the typeset engine and the live preview. ATS
 * friendly: real text in reading order, standard section names, no text in
 * images, links kept. MuPDF lays out tables but not floats, so dates sit in
 * a right-aligned table cell, and the sidebar template is a table whose
 * sidebar cell spans every row of the main column (rows may break across
 * pages; nothing follows the table).
 */
import { breakLigatures, esc, pt } from '@/components/business/html';
import { BULLET, parseInline, safeHref } from './inline';
import type { Entry, Resume, Section, TemplateId } from './model';

export const PAPER = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } } as const;
export const MARGINS: Record<TemplateId, { x: number; y: number }> = {
  modern: { x: 46, y: 40 },
  classic: { x: 50, y: 42 },
  compact: { x: 38, y: 34 },
  sidebar: { x: 36, y: 36 },
};
const SIZE = { small: 9, medium: 9.8, large: 10.6 } as const;
const MARGIN_SCALE = { narrow: 0.72, normal: 1, wide: 1.3 } as const;
const SPACING = { compact: 0.8, normal: 1, relaxed: 1.25 } as const;
const SIDE_KINDS = new Set(['skills', 'links', 'education']);

export const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: 'modern', label: 'Modern', hint: 'One column, accent headings' },
  { id: 'classic', label: 'Classic', hint: 'One column, centred serif header' },
  { id: 'compact', label: 'Compact', hint: 'Headings in a left margin, dense' },
  { id: 'sidebar', label: 'Two-column', hint: 'Skills and contact in a sidebar' },
];

function hasContent(e: Entry): boolean {
  return !!(e.title.trim() || e.org.trim() || e.text.trim() || e.url.trim() || e.start.trim() || e.end.trim());
}

function href(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^mailto:|^https?:\/\//i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}

function link(raw: string, label = raw): string {
  const h = href(raw);
  return h ? `<a href="${esc(h)}">${esc(label.trim())}</a>` : esc(label.trim());
}

/** **bold**, *italic* and [label](link) as HTML. */
export function inlineHtml(text: string): string {
  return parseInline(text)
    .map((s) => {
      if (s.href) {
        const h = safeHref(s.href);
        return h ? `<a href="${esc(h)}">${esc(s.text)}</a>` : esc(s.text);
      }
      if (s.bold) return `<b>${esc(s.text)}</b>`;
      if (s.italic) return `<i>${esc(s.text)}</i>`;
      return esc(s.text);
    })
    .join('');
}

/** Lines beginning with "- " or "• " become a bulleted list; other lines paragraphs. */
export function richText(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inlineHtml(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = BULLET.exec(line);
    if (m) {
      list.push(m[1] as string);
      continue;
    }
    flush();
    if (line) out.push(`<p>${inlineHtml(line)}</p>`);
  }
  flush();
  return out.join('');
}

function dates(e: Entry): string {
  const a = e.start.trim();
  const b = e.end.trim();
  return a && b ? `${esc(a)} – ${esc(b)}` : esc(a || b);
}

/** Title/org line with dates and place on the right. */
function entryHead(e: Entry, width: number, kind: Section['kind'], compactLine: boolean): string {
  const right = dates(e);
  const loc = e.location.trim() ? esc(e.location.trim()) : '';
  const title = e.title.trim() ? `<span class="et">${esc(e.title.trim())}</span>` : '';
  const org = e.org.trim() ? esc(e.org.trim()) : '';
  const url = e.url.trim() ? link(e.url) : '';
  if (width < 220) {
    // Narrow column: stacked lines.
    const meta = [right, loc].filter(Boolean).join(' &#183; ');
    return [title, org ? `<span class="eo">${org}</span>` : '', url ? `<span class="eo">${url}</span>` : '', meta ? `<span class="dt">${meta}</span>` : '']
      .filter(Boolean)
      .map((x) => `<div>${x}</div>`)
      .join('');
  }
  const rw = Math.min(150, Math.max(80, width * 0.3));
  const lw = width - rw;
  const row = (l: string, r: string, cls = '') =>
    l || r ? `<table class="eh${cls}"><tr><td style="width:${pt(lw)}">${l}</td><td class="r dt" style="width:${pt(rw)}">${r}</td></tr></table>` : '';
  if (kind === 'projects') return row(`${title}${url ? `<span class="eo">${title ? ' &#183; ' : ''}${url}</span>` : ''}`, right);
  // The comma sits inside the organisation's span: MuPDF raises a lone comma between styled runs.
  if (compactLine) return row(`${title}${org ? `<span class="eo">${title ? ', ' : ''}${org}</span>` : ''}`, [right, loc].filter(Boolean).join(' &#183; '));
  return row(title || `<span class="et">${org}</span>`, right) + (title && (org || loc) ? row(org ? `<span class="eo">${org}</span>` : '', loc, ' sub') : '');
}

function sectionBody(s: Section, width: number, tpl: TemplateId): string {
  const entries = s.entries.filter(hasContent);
  if (!entries.length) return '';
  switch (s.kind) {
    case 'summary':
      return `<div class="sum">${entries.map((e) => richText(e.text)).join('')}</div>`;
    case 'skills':
      return entries
        .map((e) => `<div class="sk">${e.title.trim() ? `<b>${esc(e.title.trim())}:</b> ` : ''}${inlineHtml(e.text.replace(/\s*\n\s*/g, ', ').trim())}</div>`)
        .join('');
    case 'links':
      return entries.map((e) => `<div class="sk">${e.title.trim() ? `<b>${esc(e.title.trim())}:</b> ` : ''}${link(e.url || e.text)}</div>`).join('');
    default:
      return entries
        .map((e) => `<div class="ent">${entryHead(e, width, s.kind, tpl === 'compact')}${e.text.trim() ? `<div class="tx">${richText(e.text)}</div>` : ''}</div>`)
        .join('');
  }
}

/** A section split into pieces that may start a new page: one per entry (short lists stay whole). */
function chunks(s: Section): Section[] {
  const entries = s.entries.filter(hasContent);
  if (s.kind === 'summary' || s.kind === 'skills' || s.kind === 'links') return [{ ...s, entries }];
  return entries.map((e) => ({ ...s, entries: [e] }));
}

function contactItems(r: Resume): string[] {
  const p = r.profile;
  return [
    p.email.trim() ? link(p.email) : '',
    p.phone.trim() ? esc(p.phone.trim()) : '',
    p.location.trim() ? esc(p.location.trim()) : '',
    p.website.trim() ? link(p.website) : '',
    p.linkedin.trim() ? link(p.linkedin) : '',
    p.github.trim() ? link(p.github) : '',
  ].filter(Boolean);
}

export type RenderedResume = { body: string; css: string; width: number; height: number; margin: { x: number; y: number }; fontSize: number };

export function renderResume(r: Resume): RenderedResume {
  const paper = PAPER[r.paper];
  const base = MARGINS[r.template];
  const k = MARGIN_SCALE[r.margins];
  const m = { x: Math.round(base.x * k), y: Math.round(base.y * k) };
  const W = paper.width - 2 * m.x;
  const tpl = r.template;
  const p = r.profile;
  const sections = r.sections.filter((s) => !s.hidden && s.entries.some(hasContent));
  const heading = (s: Section) => `<h2>${esc((s.title.trim() || 'Section').toUpperCase())}</h2>`;
  const name = esc(p.name.trim() || 'Your Name');
  const contacts = contactItems(r);
  let body = '';

  if (tpl === 'sidebar') {
    const sideW = 150;
    const gap = 18;
    const mainW = W - sideW - gap;
    body += `<div class="nm">${name}</div>${p.headline.trim() ? `<div class="hl">${esc(p.headline.trim())}</div>` : ''}<div class="hr"></div>`;
    const side = sections.filter((s) => SIDE_KINDS.has(s.kind));
    const main = sections.filter((s) => !SIDE_KINDS.has(s.kind));
    let sideHtml = contacts.length ? `<h2>CONTACT</h2>${contacts.map((c) => `<div class="ci">${c}</div>`).join('')}` : '';
    for (const s of side) sideHtml += heading(s) + sectionBody(s, sideW, tpl);
    // One row per heading and per entry, so the main column can break between entries.
    const rows: string[] = [];
    for (const s of main) {
      const entries = s.entries.filter(hasContent);
      if (s.kind === 'summary') {
        rows.push(heading(s) + sectionBody(s, mainW, tpl));
        continue;
      }
      entries.forEach((e, i) => rows.push((i === 0 ? heading(s) : '') + sectionBody({ ...s, entries: [e] }, mainW, tpl)));
    }
    // A last empty row takes any height the sidebar adds, so entries keep their spacing.
    rows.push('');
    body += `<table class="cols">${rows
      .map(
        (cell, i) =>
          `<tr>${i === 0 ? `<td class="side" rowspan="${rows.length}" style="width:${pt(sideW)}">${sideHtml}</td><td class="gap" rowspan="${rows.length}" style="width:${pt(gap)}"></td>` : ''}<td class="main" style="width:${pt(mainW)}">${cell}</td></tr>`,
      )
      .join('')}</table>`;
  } else {
    if (tpl === 'classic') {
      body += `<div class="nm c">${name}</div>${p.headline.trim() ? `<div class="hl c">${esc(p.headline.trim())}</div>` : ''}<div class="ct c">${contacts.join(' &#160;|&#160; ')}</div>`;
    } else {
      body += `<div class="nm">${name}</div>${p.headline.trim() ? `<div class="hl">${esc(p.headline.trim())}</div>` : ''}<div class="ct">${contacts.join(' &#160;&#183;&#160; ')}</div>`;
    }
    if (tpl === 'compact') {
      const hw = 96;
      const cw = W - hw - 10;
      body += `<div class="hr"></div>`;
      // One table, one row per entry (MuPDF cannot split a single tall row across pages).
      let rows = '';
      for (const s of sections) {
        chunks(s).forEach((chunk, i) => {
          rows += `<tr class="${i === 0 ? 'first' : ''}"><td class="sh" style="width:${pt(hw)}">${i === 0 ? esc(s.title.trim() || 'Section') : ''}</td><td style="width:10pt"></td><td style="width:${pt(cw)}">${sectionBody(chunk, cw, tpl)}</td></tr>`;
        });
      }
      body += `<table class="sec">${rows}</table>`;
    } else {
      // The heading travels with the first entry in one table row: MuPDF would
      // otherwise leave the heading's rule behind at the foot of the old page.
      for (const s of sections) {
        chunks(s).forEach((chunk, i) => {
          const html = sectionBody(chunk, W, tpl);
          body += i === 0 ? `<table class="keep"><tr><td style="width:${pt(W)}">${heading(s)}${html}</td></tr></table>` : html;
        });
      }
    }
  }

  const fontSize = SIZE[r.size];
  return { body: breakLigatures(body), css: resumeCss(r, fontSize), width: paper.width, height: paper.height, margin: m, fontSize };
}

function resumeCss(r: Resume, fs: number): string {
  const a = r.accent;
  const sp = SPACING[r.spacing];
  const family = r.font === 'serif' ? 'serif' : r.font === 'calibri' ? 'Calibri' : 'sans-serif';
  const muted = '#555b63';
  const base = `
body{font-family:${family};font-size:${fs}pt;line-height:${(1.2 + 0.12 * sp).toFixed(3)};color:#1d2125;margin:0}
body a{color:#1d2125;text-decoration:none}
body .ct a,body .ci a{color:#3a4047}
p{margin:0 0 2pt}
ul{margin:1pt 0 0;padding-left:11pt}
li{margin:0 0 1.2pt}
table{border-collapse:collapse;margin:0}
td{padding:0;vertical-align:top}
.r{text-align:right}
.c{text-align:center}
.nm{font-size:${(fs * 2.25).toFixed(1)}pt;font-weight:bold;line-height:1.1;color:#111418}
.hl{font-size:${(fs * 1.15).toFixed(1)}pt;color:${muted};margin:2pt 0 0}
.ct{font-size:${(fs * 0.92).toFixed(1)}pt;color:${muted};margin:5pt 0 0}
h2{font-size:${(fs * 1.02).toFixed(1)}pt;font-weight:bold;margin:${(12 * sp).toFixed(1)}pt 0 4pt;padding:0 0 2pt;page-break-after:avoid}
.ent{margin:0 0 ${(6 * sp).toFixed(1)}pt}
.et{font-weight:bold;color:#111418}
.eo{color:#30353b}
.dt{color:${muted};font-size:${(fs * 0.92).toFixed(1)}pt}
table.sub td{padding-top:0.5pt}
.tx{margin:1.5pt 0 0}
.sk{margin:0 0 2.5pt}
.sum p{margin:0 0 3pt}
`;
  switch (r.template) {
    case 'classic':
      return `${base}
.nm{font-size:${(fs * 2.1).toFixed(1)}pt}
.ct{margin-top:4pt}
h2{border-bottom:0.8pt solid #1d2125;color:#111418;margin-top:13pt}
.eo{font-style:italic}
`;
    case 'compact':
      return `${base}
.nm{font-size:${(fs * 2).toFixed(1)}pt;color:${a}}
.hr{border-top:1pt solid ${a};margin:8pt 0 4pt;height:0}
table.sec tr.first td{padding-top:7pt}
td.sh{font-weight:bold;color:${a};font-size:${(fs * 0.98).toFixed(1)}pt;padding-top:0.5pt}
.ent{margin:0 0 4pt}
li{margin:0 0 0.6pt}
`;
    case 'sidebar':
      return `${base}
.nm{color:${a}}
.hr{border-top:1.2pt solid ${a};margin:8pt 0 2pt;height:0}
h2{color:${a};margin:11pt 0 3pt;border-bottom:0.6pt solid #d5d9de}
td.side{font-size:${(fs * 0.94).toFixed(1)}pt}
td.side .sk{margin:0 0 4pt}
td.side .ent{margin:0 0 5pt}
.ci{margin:0 0 2.5pt;color:#30353b}
`;
    default:
      return `${base}
.nm{color:${a}}
h2{color:${a};border-bottom:0.7pt solid #d5d9de}
`;
  }
}
