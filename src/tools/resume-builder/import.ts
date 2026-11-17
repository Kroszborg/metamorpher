/**
 * A starting draft from an existing résumé (PDF or DOCX): text lines with
 * headings and bullets, sorted into sections by their headings. Heuristic:
 * the user reviews everything afterwards. Client only.
 */
import { newId } from '@/lib/files';
import { emptyResume, KIND_LABEL, newEntry, type Profile, type Resume, type Section, type SectionKind } from './model';

export type Line = { text: string; heading: boolean; bullet: boolean };

const HEADINGS: [RegExp, SectionKind][] = [
  [/^(professional\s+)?(summary|profile|objective|about( me)?|career objective)$/i, 'summary'],
  [/^(work\s+|professional\s+)?(experience|employment( history)?|work history|career history)$/i, 'experience'],
  [/^(education|academic( background| qualifications)?|qualifications)$/i, 'education'],
  [/^(technical\s+|key\s+|core\s+)?(skills|competencies|technologies|tech stack|expertise)$/i, 'skills'],
  [/^(personal\s+|selected\s+|key\s+)?projects$/i, 'projects'],
  [/^(links|online presence|profiles)$/i, 'links'],
];
const OTHER_HEADING = /^(certifications?|awards|honou?rs|publications|languages|volunteer(ing)?|interests|achievements|courses|training|references)$/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:${MONTH}\\s*)?(?:\\d{1,2}[/.-])?(?:19|20)\\d{2}`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now|till date|ongoing)`, 'i');
const SINGLE = new RegExp(`^(${DATE})$`, 'i');

function kindOf(text: string): SectionKind | null {
  const t = text.replace(/[:\s]+$/, '').trim();
  for (const [re, k] of HEADINGS) if (re.test(t)) return k;
  if (OTHER_HEADING.test(t)) return 'custom';
  return null;
}

function contactFrom(lines: string[], p: Profile): void {
  const all = lines.join('  ');
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(all);
  if (email) p.email = email[0];
  const phone = /(\+?\d[\d\s().-]{8,}\d)/.exec(all.replace(email?.[0] ?? '\u0000', ' '));
  if (phone) p.phone = phone[1]!.trim();
  const li = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[\w/%-]+/i.exec(all);
  if (li) p.linkedin = li[0].replace(/^https?:\/\/(www\.)?/i, '');
  const gh = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i.exec(all);
  if (gh) p.github = gh[0].replace(/^https?:\/\/(www\.)?/i, '');
}

/** Builds a résumé from text lines. */
export function draftFromLines(lines: Line[]): Resume {
  const r = emptyResume();
  r.sections = [];
  const clean = lines
    .map((l) => {
      const text = l.text.replace(/\s+/g, ' ').trim();
      // List labels drawn as text (DOCX bullets, pasted PDFs): '•', '–', '▪', '➢'…
      const m = /^[•·▪◦‣●○■□➢►✓\-–*]\s*(.+)$/.exec(text);
      return m ? { ...l, text: m[1] as string, bullet: true } : { ...l, text };
    })
    .filter((l) => l.text);
  if (!clean.length) throw new Error('No text was found. A scanned résumé needs OCR first.');
  r.profile.name = clean[0]!.text.length <= 60 ? clean[0]!.text : '';
  // Header lines: up to the first recognised heading.
  let i = r.profile.name ? 1 : 0;
  const header: string[] = [];
  while (i < clean.length && !kindOf(clean[i]!.text)) {
    header.push(clean[i]!.text);
    i++;
    if (header.length > 8) break;
  }
  contactFrom(header, r.profile);
  const headline = header.find((h) => !/@|\d{5,}|linkedin|github|http/i.test(h) && h.length < 80);
  if (headline) r.profile.headline = headline;

  let current: Section | null = null;
  const push = (kind: SectionKind, title: string) => {
    current = { id: newId('s'), kind, title, hidden: false, entries: [] };
    r.sections.push(current);
  };
  for (; i < clean.length; i++) {
    const l = clean[i]!;
    const k = l.text.length <= 40 ? kindOf(l.text) : null;
    if (k) {
      push(k, k === 'custom' ? l.text.replace(/:$/, '') : KIND_LABEL[k]);
      continue;
    }
    if (!current) push('summary', 'Summary');
    const s = current as unknown as Section;
    const last = s.entries.at(-1);
    if (s.kind === 'summary') {
      if (last) last.text += `\n${l.text}`;
      else s.entries.push(newEntry({ text: l.text }));
      continue;
    }
    if (s.kind === 'skills' || s.kind === 'links') {
      const m = /^([^:]{2,30}):\s*(.+)$/.exec(l.text.replace(/^[-•*]\s*/, ''));
      s.entries.push(m ? newEntry({ title: m[1]!.trim(), text: m[2]!.trim(), url: s.kind === 'links' ? m[2]!.trim() : '' }) : newEntry({ text: l.text.replace(/^[-•*]\s*/, ''), url: s.kind === 'links' ? l.text : '' }));
      continue;
    }
    if (l.bullet) {
      const e = last ?? (s.entries.push(newEntry()), s.entries.at(-1)!);
      e.text += `${e.text ? '\n' : ''}- ${l.text.replace(/^[-•*▪◦]\s*/, '')}`;
      continue;
    }
    // A plain line: dates, a new entry's title, or the entry's organisation.
    const range = RANGE.exec(l.text);
    const single = SINGLE.exec(l.text);
    if (last && !last.text && (range || single) && !last.start) {
      if (range) {
        last.start = range[1]!;
        last.end = range[2]!.replace(/^\w/, (c) => c.toUpperCase());
        const rest = l.text.replace(range[0], '').replace(/^[\s|,·–-]+|[\s|,·–-]+$/g, '');
        if (rest && !last.location) last.location = rest;
      } else last.start = single![1]!;
      continue;
    }
    if (last && !last.text && !last.org && last.title) {
      if (range) {
        last.start = range[1]!;
        last.end = range[2]!;
        last.org = l.text.replace(range[0], '').replace(/^[\s|,·–-]+|[\s|,·–-]+$/g, '');
      } else last.org = l.text;
      continue;
    }
    if (last && last.text && !l.heading && l.text.length > 60) {
      last.text += `\n${l.text}`;
      continue;
    }
    const e = newEntry({ title: l.text });
    if (range) {
      e.start = range[1]!;
      e.end = range[2]!;
      e.title = l.text.replace(range[0], '').replace(/^[\s|,·–-]+|[\s|,·–-]+$/g, '');
    }
    s.entries.push(e);
  }
  for (const s of r.sections) if (!s.entries.length) s.entries.push(newEntry());
  if (!r.sections.length) r.sections.push({ id: newId('s'), kind: 'summary', title: 'Summary', hidden: false, entries: [newEntry()] });
  return r;
}

/** Text lines of a PDF via the structure extractor (headings from font sizes, list items). */
export async function linesFromPdf(file: Blob, signal?: AbortSignal): Promise<Line[]> {
  const { pdfExtract, buildDocument } = await import('@/engines/pdf-extract');
  const raw = await pdfExtract.structure(file, { images: false, signal });
  const doc = buildDocument(raw, { dropRunning: true, pageBreaks: false });
  const out: Line[] = [];
  for (const b of doc.blocks) {
    if (b.kind !== 'para') continue;
    const text = b.runs.map((x) => x.text).join('');
    const bold = b.runs.length > 0 && b.runs.every((x) => x.bold || !x.text.trim());
    for (const part of text.split(/\n/)) {
      out.push({ text: part, heading: b.level > 0 || (bold && part.length < 40 && part === part.toUpperCase()), bullet: b.list || /^[-•*▪◦]\s/.test(part.trim()) });
    }
  }
  return out;
}

/** Text lines of a DOCX via the document tools' reader. */
export async function linesFromDocx(file: Blob): Promise<Line[]> {
  const { docxToHtml } = await import('@/components/doc-tools/docx');
  const { html } = await docxToHtml(await file.arrayBuffer());
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: Line[] = [];
  const LEAF = /^(H[1-6]|P|LI)$/;
  // Paragraphs are <p>/<h*>; list items come as a positioned <div> holding the label text and the item.
  const walk = (el: Element) => {
    for (const child of el.children) {
      const ownText = [...child.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      if (LEAF.test(child.tagName) || (child.tagName === 'DIV' && ownText)) {
        const text = (child.textContent ?? '').trim();
        if (text) out.push({ text, heading: /^H\d$/.test(child.tagName), bullet: child.tagName === 'LI' });
      } else walk(child);
    }
  };
  walk(dom.body);
  return out;
}
