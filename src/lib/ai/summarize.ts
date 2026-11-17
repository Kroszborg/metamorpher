/**
 * Map-reduce summarisation of long documents, independent of where the model
 * runs: `complete` is a cloud provider or an on-device model. Parts are sized
 * to the model's budget, summarised one by one ("map"), then the notes are
 * merged ("reduce", repeated while they are still too long) into the final
 * summary in the chosen style.
 */
import type { ChatMessage } from './types';

export type SummaryStyle = 'short' | 'detailed' | 'bullets' | 'chapters';

export type Section = { title: string; firstPage: number; lastPage: number; text: string };

export type Complete = (messages: ChatMessage[], opts: { maxTokens: number; onText?: (full: string) => void }) => Promise<string>;

export type SummarizeProgress = (done: number, total: number, note: string) => void;

const SYSTEM =
  'You summarise documents faithfully. Use only the text you are given. Keep names, numbers, dates and conclusions exact. Write in the language of the document. Never add facts.';

const FINAL: Record<Exclude<SummaryStyle, 'chapters'>, string> = {
  short: 'Write a short summary of the whole document in one paragraph of 3–5 sentences.',
  detailed:
    'Write a detailed summary of the whole document: a one-sentence overview, then several paragraphs covering every main point, with the key numbers and conclusions. Use Markdown headings where they help.',
  bullets: 'Summarise the whole document as 5–10 Markdown bullet points, most important first. One line each.',
};

/** Splits text into pieces of at most `size` characters at paragraph or sentence breaks. */
export function splitText(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('. ', size) + 1;
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Page-labelled parts of a document, each at most `size` characters. */
export function partsOf(pages: readonly string[], size: number, unit: 'page' | 'section'): { label: string; text: string }[] {
  const parts: { label: string; text: string }[] = [];
  let cur = '';
  let first = 1;
  const label = (a: number, b: number) => (a === b ? `${unit} ${a}` : `${unit}s ${a}–${b}`);
  pages.forEach((p, i) => {
    const page = i + 1;
    const t = p.trim();
    if (!t) return;
    if (t.length > size) {
      if (cur) parts.push({ label: label(first, page - 1), text: cur });
      cur = '';
      for (const piece of splitText(t, size)) parts.push({ label: label(page, page), text: piece });
      first = page + 1;
      return;
    }
    if (cur && cur.length + t.length + 2 > size) {
      parts.push({ label: label(first, page - 1), text: cur });
      cur = '';
      first = page;
    }
    if (!cur) first = page;
    cur += (cur ? '\n\n' : '') + t;
  });
  if (cur) parts.push({ label: label(first, pages.length), text: cur });
  return parts;
}

type Ctx = { complete: Complete; budget: number; signal: AbortSignal; step: () => void; note: (n: string) => void };

function check(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
}

async function mapParts(parts: { label: string; text: string }[], ctx: Ctx, title: string): Promise<string[]> {
  const notes: string[] = [];
  for (const [i, part] of parts.entries()) {
    check(ctx.signal);
    ctx.note(`Reading ${part.label} (${i + 1} of ${parts.length})`);
    const out = await ctx.complete(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `This is ${part.label} of "${title}".\n\n---\n${part.text}\n---\n\nWrite concise notes on this part: the main points, with any important names, numbers and conclusions. Plain sentences or short bullets, no preamble.`,
        },
      ],
      { maxTokens: 500 },
    );
    notes.push(`(${part.label}) ${out.trim()}`);
    ctx.step();
  }
  return notes;
}

/** Merges notes until they fit the budget, then writes the final text with `instruction`. */
async function reduce(notes: string[], instruction: string, ctx: Ctx, title: string, onText?: (full: string) => void): Promise<string> {
  let current = notes;
  while (current.join('\n\n').length > ctx.budget && current.length > 1) {
    check(ctx.signal);
    const groups: string[][] = [];
    let g: string[] = [];
    for (const n of current) {
      if (g.length && [...g, n].join('\n\n').length > ctx.budget) {
        groups.push(g);
        g = [];
      }
      g.push(n);
    }
    if (g.length) groups.push(g);
    if (groups.length === current.length) {
      // Each note alone is near the budget: trim instead of looping forever.
      current = current.map((n) => n.slice(0, Math.floor(ctx.budget / current.length)));
      break;
    }
    const merged: string[] = [];
    for (const [i, group] of groups.entries()) {
      ctx.note(`Combining notes (${i + 1} of ${groups.length})`);
      merged.push(
        (
          await ctx.complete(
            [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: `Notes on consecutive parts of "${title}":\n\n${group.join('\n\n')}\n\nCombine these into one set of concise notes, keeping the part labels in brackets.` },
            ],
            { maxTokens: 700 },
          )
        ).trim(),
      );
      ctx.step();
    }
    current = merged;
  }
  check(ctx.signal);
  ctx.note('Writing the summary');
  const result = await ctx.complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${notes.length > 1 || current !== notes ? 'Notes on' : 'Text of'} "${title}":\n\n${current.join('\n\n')}\n\n${instruction}` },
    ],
    { maxTokens: 1200, onText },
  );
  ctx.step();
  return result.trim();
}

/** Estimated number of model calls, for the progress bar. */
function estimateCalls(chars: number, budget: number): number {
  const parts = Math.max(1, Math.ceil(chars / budget));
  return parts === 1 ? 1 : parts + Math.ceil(parts / 6) + 1;
}

export async function summarize(
  input: { title: string; pages: readonly string[]; unit: 'page' | 'section'; sections: Section[] | null },
  style: SummaryStyle,
  o: { complete: Complete; budget: number; signal: AbortSignal; onProgress: SummarizeProgress; onText?: (full: string) => void },
): Promise<string> {
  const total = input.pages.reduce((n, p) => n + p.length, 0);
  let done = 0;
  let planned = 1;
  let note = '';
  const ctx: Ctx = {
    complete: o.complete,
    budget: o.budget,
    signal: o.signal,
    step: () => {
      done += 1;
      o.onProgress(done, Math.max(planned, done + 1), note);
    },
    note: (n) => {
      note = n;
      o.onProgress(done, Math.max(planned, done + 1), n);
    },
  };

  if (style !== 'chapters') {
    planned = estimateCalls(total, o.budget);
    // Short documents go in one call, as full text.
    if (total <= o.budget) {
      const text = input.pages.map((p, i) => `[${input.unit} ${i + 1}]\n${p.trim()}`).join('\n\n');
      return reduce([text], FINAL[style], ctx, input.title, o.onText);
    }
    const notes = await mapParts(partsOf(input.pages, o.budget, input.unit), ctx, input.title);
    return reduce(notes, FINAL[style], ctx, input.title, o.onText);
  }

  const sections = input.sections ?? [];
  planned = sections.reduce((n, s) => n + estimateCalls(s.text.length, o.budget), 0);
  const out: string[] = [];
  for (const [i, s] of sections.entries()) {
    check(o.signal);
    const range = s.firstPage === s.lastPage ? `${input.unit} ${s.firstPage}` : `${input.unit}s ${s.firstPage}–${s.lastPage}`;
    const generic = /^(Pages?|Sections?) \d/.test(s.title);
    const heading = generic ? `## ${s.title}` : `## ${s.title} (${range})`;
    const instruction = 'Summarise this chapter in 2–4 sentences. No heading, no preamble.';
    ctx.note(`Chapter ${i + 1} of ${sections.length}: ${s.title}`);
    let body: string;
    if (s.text.trim().length === 0) body = '_No text on these pages._';
    else if (s.text.length <= o.budget) body = await reduce([s.text], instruction, ctx, `${input.title}: ${s.title}`);
    else {
      const parts = splitText(s.text, o.budget).map((text, k) => ({ label: `${range}, part ${k + 1}`, text }));
      body = await reduce(await mapParts(parts, ctx, input.title), instruction, ctx, `${input.title}: ${s.title}`);
    }
    out.push(`${heading}\n\n${body}`);
    o.onText?.(out.join('\n\n'));
  }
  return out.join('\n\n');
}

/**
 * Chapters from the PDF outline (top-level bookmarks), else from Markdown-like
 * headings in text documents, else groups of pages.
 */
export function chaptersOf(
  pages: readonly string[],
  outline: readonly { title: string; level: number; page: number }[] | null,
  unit: 'page' | 'section',
): Section[] {
  const n = pages.length;
  const top = (outline ?? []).filter((o) => o.level === Math.min(...(outline ?? []).map((x) => x.level)) && o.page >= 0 && o.page < n);
  const starts = [...new Map(top.map((o) => [o.page, o.title.trim() || `Section at ${unit} ${o.page + 1}`])).entries()].sort((a, b) => a[0] - b[0]);
  if (starts.length >= 2) {
    if ((starts[0]?.[0] ?? 0) > 0) starts.unshift([0, 'Opening pages']);
    return starts.map(([page, title], i) => {
      const end = (starts[i + 1]?.[0] ?? n) - 1;
      return { title, firstPage: page + 1, lastPage: end + 1, text: pages.slice(page, end + 1).join('\n\n') };
    });
  }
  const group = n <= 12 ? Math.max(1, Math.ceil(n / 4)) : 10;
  const out: Section[] = [];
  for (let i = 0; i < n; i += group) {
    const last = Math.min(n, i + group);
    out.push({
      title: last - i === 1 ? `${unit === 'page' ? 'Page' : 'Section'} ${i + 1}` : `${unit === 'page' ? 'Pages' : 'Sections'} ${i + 1}–${last}`,
      firstPage: i + 1,
      lastPage: last,
      text: pages.slice(i, last).join('\n\n'),
    });
  }
  return out;
}
