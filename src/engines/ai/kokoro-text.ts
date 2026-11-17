/**
 * English text → phonemes for the Kokoro-82M speech model, following the
 * reference implementation in kokoro-js (Apache-2.0): light normalisation
 * (titles, years, times, money, decimals), eSpeak NG phonemes via the
 * `phonemizer` package (eSpeak NG compiled to WebAssembly, GPL-3.0), and
 * Kokoro's phoneme fix-ups. Runs inside the AI worker.
 */

function year(text: string): string {
  if (text.includes('.')) return text;
  if (text.includes(':')) {
    const [h, m] = text.split(':').map(Number);
    return m === 0 ? `${h} o'clock` : (m ?? 0) < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const y = parseInt(text.slice(0, 4), 10);
  if (y < 1100 || y % 1000 < 10) return text;
  const left = text.slice(0, 2);
  const right = parseInt(text.slice(2, 4), 10);
  const s = text.endsWith('s') ? 's' : '';
  if (y % 1000 >= 100 && y % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`;
    if (right < 10) return `${left} oh ${right}${s}`;
  }
  return `${left} ${right}${s}`;
}

function money(text: string): string {
  const unit = text[0] === '$' ? 'dollar' : 'pound';
  const amount = text.slice(1);
  if (Number.isNaN(Number(amount))) return `${amount} ${unit}s`;
  if (!amount.includes('.')) return `${amount} ${unit}${amount === '1' ? '' : 's'}`;
  const [whole, frac = ''] = amount.split('.');
  const cents = parseInt(frac.padEnd(2, '0'), 10);
  const small = text[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${small}`;
}

function decimal(text: string): string {
  const [a, b = ''] = text.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, year)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, decimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;

/** Phonemes for one chunk of English text. `british` picks the en-GB voice set. */
export async function toPhonemes(text: string, british: boolean): Promise<string> {
  const { phonemize } = await import('phonemizer');
  const normal = normalizeText(text);
  const parts: { punct: boolean; text: string }[] = [];
  let last = 0;
  for (const m of normal.matchAll(PUNCT)) {
    if (last < m.index) parts.push({ punct: false, text: normal.slice(last, m.index) });
    if (m[0].length > 0) parts.push({ punct: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < normal.length) parts.push({ punct: false, text: normal.slice(last) });
  const lang = british ? 'en' : 'en-us';
  const joined = (
    await Promise.all(parts.map(async (p) => (p.punct ? p.text : (await phonemize(p.text, lang)).join(' '))))
  ).join('');
  let out = joined
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (!british) out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return out.trim();
}
