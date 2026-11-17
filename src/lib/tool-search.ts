import { getCategory } from '@/tools/categories';

/**
 * Tool search shared by the command palette and the home page search, so both
 * rank results the same way. Matching ignores case and accents ("resume"
 * finds "résumé"), searches titles, keywords and descriptions, and tolerates
 * small typos in titles and keywords ("mrege", "compres").
 */
export const SEP = ' | ';

/** The string a palette item is matched against: its label first, then a hint and an id. */
export function searchValue(label: string, hint = '', id = ''): string {
  return `${label}${SEP}${hint} ${id}`;
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Optimal string alignment distance (Levenshtein plus transpositions), capped for speed. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

function nearWord(word: string, candidates: string[]): boolean {
  if (word.length < 4) return candidates.some((t) => t.startsWith(word));
  const max = word.length >= 8 ? 2 : 1;
  return candidates.some(
    (t) =>
      distance(word, t, max) <= max || (t.length > word.length && distance(word, t.slice(0, word.length), max) <= max),
  );
}

/** Scores at or above this are real matches; below it they are only "related". */
export const STRONG_MATCH = 0.4;

/**
 * How well `query` matches a tool-like item, from 0 (no match) to 1.
 *   1     title starts with the query
 *   0.9   a title word starts with it
 *   0.8   a keyword starts with it
 *   0.65  every query word starts a word in the title, keywords or description
 *   0.55  every query word appears somewhere in them
 *   0.4   every query word is a near miss (typo) of a title or keyword word
 *   0.2   only the item's category mentions it (shown as related, not as a match)
 */
export function scoreMatch(
  query: string,
  item: { title: string; keywords?: readonly string[]; description?: string; related?: readonly string[] },
): number {
  const q = normalize(query.trim());
  if (!q) return 1;
  const words = q.split(/\s+/).filter(Boolean);
  const title = normalize(item.title);
  const titleTokens = tokens(item.title);
  const keywords = (item.keywords ?? []).map(normalize);
  const keywordTokens = keywords.flatMap((k) => tokens(k));

  if (title.startsWith(q)) return 1;
  if (titleTokens.some((w) => w.startsWith(q))) return 0.9;
  if (keywords.some((k) => k.startsWith(q)) || (words.length === 1 && keywordTokens.some((w) => w.startsWith(q))))
    return 0.8;

  const hay = [title, ...keywords, normalize(item.description ?? '')].join(' ');
  const hayTokens = [...titleTokens, ...keywordTokens, ...tokens(item.description ?? '')];
  if (words.every((w) => hayTokens.some((t) => t.startsWith(w)))) return 0.65;
  if (words.every((w) => hay.includes(w))) return 0.55;
  if (words.every((w) => nearWord(w, [...titleTokens, ...keywordTokens]))) return 0.4;

  const related = (item.related ?? []).flatMap((r) => tokens(r));
  if (words.every((w) => w.length >= 3 && related.some((t) => t.startsWith(w)))) return 0.2;
  return 0;
}

/** cmdk filter for the command palette: the label is the part of `value` before SEP. */
export function rankMatch(value: string, search: string, keywords?: string[]): number {
  const [label = '', rest = ''] = value.split(SEP);
  const score = scoreMatch(search, { title: label, keywords, related: [rest] });
  return score >= STRONG_MATCH ? score : 0;
}

type Searchable = {
  slug: string;
  title: string;
  description: string;
  category: string;
  keywords: readonly string[];
};

export type SearchHit<T> = { tool: T; score: number };

/** Every tool matching `query`, best first (registry order breaks ties), including weak "related" hits. */
export function searchTools<T extends Searchable>(tools: readonly T[], query: string): SearchHit<T>[] {
  if (!query.trim()) return [];
  return tools
    .map((tool, i) => {
      const category = getCategory(tool.category);
      const score = scoreMatch(query, {
        title: tool.title,
        keywords: tool.keywords,
        description: tool.description,
        related: category ? [category.title, category.description] : [],
      });
      return { tool, score, i };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ tool, score }) => ({ tool, score }));
}
