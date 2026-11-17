/**
 * On-device retrieval for the document AI tools: split pages into passages,
 * rank them for a question with BM25 (always available, no download) and,
 * when an embedding model is present, blend in cosine similarity.
 * Nothing here touches the network.
 */

export type SourceDoc = {
  id: string;
  name: string;
  /** 'page' for PDFs, 'section' for text documents split into parts. */
  unit: 'page' | 'section';
  /** Text per page (or section); index 0 is page 1. */
  pages: string[];
};

export type Passage = {
  id: number;
  docId: string;
  docName: string;
  /** 1-based page or section number. */
  page: number;
  unit: 'page' | 'section';
  text: string;
};

const TARGET = 900;
const OVERLAP = 150;

function clean(text: string): string {
  return text
    .replace(/­/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits one page into passages of about `target` characters on sentence boundaries, with overlap. */
export function splitPage(text: string, target = TARGET, overlap = OVERLAP): string[] {
  const t = clean(text);
  if (t.length <= target * 1.3) return t ? [t] : [];
  const sentences = t.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n+|$)\s*/g) ?? [t];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur.length + s.length > target && cur.length > target * 0.4) {
      out.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)).replace(/^\S*\s/, '');
    }
    // Very long "sentences" (tables, lists without punctuation) are cut hard.
    if (s.length > target * 1.5) {
      for (let i = 0; i < s.length; i += target) {
        const piece = s.slice(i, i + target);
        if (cur.length + piece.length > target && cur) {
          out.push(cur.trim());
          cur = '';
        }
        cur += piece;
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function buildPassages(docs: readonly SourceDoc[]): Passage[] {
  const out: Passage[] = [];
  for (const d of docs) {
    d.pages.forEach((text, i) => {
      for (const piece of splitPage(text)) {
        out.push({ id: out.length, docId: d.id, docName: d.name, page: i + 1, unit: d.unit, text: piece });
      }
    });
  }
  return out;
}

/** Splits plain text into numbered sections of about `size` characters at paragraph breaks. */
export function sectionText(text: string, size = 3000): string[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [''];
}

// ── BM25 ──────────────────────────────────────────────────────────────────

const STOP = new Set(
  'a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our she so than that the their them then there these they this to too us was we were what when where which who whom why will with you your does do did can could should would about how many much any all also'.split(
    ' ',
  ),
);

/** Lower-cased word stems (very light stemming, any script). */
export function tokens(text: string): string[] {
  const words = text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w) || (w.length < 2 && !/\d/.test(w))) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(w: string): string {
  if (w.length <= 4 || !/^[a-z]+$/.test(w)) return w;
  return w
    .replace(/(ies)$/, 'y')
    .replace(/(sses)$/, 'ss')
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|edly|ed|ly)$/, '')
    .replace(/(ation|ations)$/, 'ate');
}

export type Index = {
  passages: Passage[];
  docTokens: Map<string, number>[];
  lengths: number[];
  avgLen: number;
  df: Map<string, number>;
  /** Unit vectors per passage when an embedding model ran. */
  vectors?: Float32Array[];
};

export function buildIndex(passages: Passage[]): Index {
  const df = new Map<string, number>();
  const docTokens = passages.map((p) => {
    const tf = new Map<string, number>();
    for (const t of tokens(`${p.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = docTokens.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const avgLen = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  return { passages, docTokens, lengths, avgLen, df };
}

function bm25(index: Index, query: string): number[] {
  const q = [...new Set(tokens(query))];
  const N = index.passages.length;
  const k1 = 1.4;
  const b = 0.75;
  return index.docTokens.map((tf, i) => {
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * (index.lengths[i] ?? 0)) / (index.avgLen || 1))));
    }
    return s;
  });
}

export type Hit = { passage: Passage; score: number };

/**
 * The passages most relevant to `query`. With `queryVector` (and vectors on the
 * index) the BM25 and cosine scores are each scaled to 0–1 and averaged.
 */
export function search(index: Index, query: string, k: number, queryVector?: Float32Array): Hit[] {
  const lexical = bm25(index, query);
  const maxL = Math.max(0, ...lexical);
  let scores = lexical.map((s) => (maxL > 0 ? s / maxL : 0));
  if (queryVector && index.vectors && index.vectors.length === index.passages.length) {
    const cos = index.vectors.map((v) => {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += (v[i] ?? 0) * (queryVector[i] ?? 0);
      return dot;
    });
    const lo = Math.min(...cos);
    const hi = Math.max(...cos);
    scores = scores.map((s, i) => 0.5 * s + 0.5 * (hi > lo ? ((cos[i] ?? 0) - lo) / (hi - lo) : 0));
  }
  return scores
    .map((score, i) => ({ passage: index.passages[i] as Passage, score }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Excerpts as the model sees them: numbered, with document and page. */
export function formatExcerpts(hits: readonly Hit[], maxChars: number): { text: string; used: Hit[] } {
  const used: Hit[] = [];
  let text = '';
  for (const h of hits) {
    const p = h.passage;
    const block = `[${used.length + 1}] ${p.docName}, ${p.unit} ${p.page}:\n${p.text}\n\n`;
    if (text.length + block.length > maxChars && used.length > 0) break;
    text += block;
    used.push(h);
  }
  return { text: text.trim(), used };
}

export type Citation<T = Hit> = { n: number; hit: T };

/**
 * Finds citations in an answer: "[2]", "[1, 3]", "[2][3]". Numbers refer to the
 * excerpts in the order they were given. Returns text segments and citations
 * in reading order for rendering.
 */
export function splitCitations<T>(answer: string, used: readonly T[]): (string | Citation<T>[])[] {
  const out: (string | Citation<T>[])[] = [];
  const re = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;
  let last = 0;
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    const nums = (m[1] ?? '').split(/[,;]/).map((x) => Number(x.trim()));
    const cites = nums.flatMap((n) => {
      const hit = used[n - 1];
      return hit ? [{ n, hit }] : [];
    });
    if (cites.length === 0) continue;
    if (m.index > last) out.push(answer.slice(last, m.index));
    out.push(cites);
    last = m.index + m[0].length;
  }
  if (last < answer.length) out.push(answer.slice(last));
  return out;
}

export const ANSWER_SYSTEM_PROMPT = `You answer questions about the user's documents using only the numbered excerpts provided with each question.
- Cite the excerpts you use with their numbers in square brackets, like [1] or [2][3], right after the statement they support.
- If the excerpts do not contain the answer, say so plainly instead of guessing.
- Be concise. Use short paragraphs or bullet points. Answer in the language of the question.`;
