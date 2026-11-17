// Personal-data detectors: patterns plus checksums, so "looks like a card
// number" becomes "is a valid card number". Pure functions with no imports,
// shared by the auto-redaction and privacy tools and runnable under node tests.

export type PiiCategory =
  | 'email'
  | 'phone'
  | 'card'
  | 'iban'
  | 'aadhaar'
  | 'pan'
  | 'ssn'
  | 'ip'
  | 'dob'
  | 'name'
  | 'address'
  | 'custom';

export const PII_CATEGORIES: readonly { id: PiiCategory; label: string; hint: string }[] = [
  { id: 'email', label: 'Email addresses', hint: 'name@example.com' },
  { id: 'phone', label: 'Phone numbers', hint: '+country numbers; Indian, US, UK and French formats; other numbers only next to “Phone”, “Mobile”, “Tel” …' },
  { id: 'card', label: 'Card numbers', hint: '13 to 19 digits that pass the Luhn check' },
  { id: 'iban', label: 'IBANs', hint: 'Bank account numbers with a valid IBAN checksum' },
  { id: 'aadhaar', label: 'Aadhaar numbers', hint: '12 digits that pass the Verhoeff check' },
  { id: 'pan', label: 'PAN numbers', hint: 'Indian Permanent Account Numbers (ABCDE1234F)' },
  { id: 'ssn', label: 'US Social Security numbers', hint: '123-45-6789, or nine digits after “SSN” / “Social Security”' },
  { id: 'ip', label: 'IP addresses', hint: 'IPv4 and IPv6' },
  { id: 'dob', label: 'Dates of birth', hint: 'Dates after “DOB”, “Date of birth”, “Born”, “जन्म तिथि”, “Geburtsdatum” … in most written forms' },
  { id: 'name', label: 'Names after a label', hint: 'Only names written after “Name:”, “Patient:”, “Father’s name:”, “नाम:” and similar' },
  { id: 'address', label: 'Addresses after a label', hint: 'Only text written after “Address:”, “Residing at”, “पता:” and similar, to the end of the line' },
  { id: 'custom', label: 'Your words and patterns', hint: 'Words and regular expressions you add' },
];

export type PiiMatch = { category: PiiCategory; start: number; end: number; text: string };

export type DetectOptions = {
  categories: ReadonlySet<PiiCategory>;
  /** Words or phrases to find (case-insensitive, whole words). */
  words?: readonly string[];
  /** Regular expressions (JavaScript syntax, matched case-insensitively). */
  patterns?: readonly string[];
};

// ── Checksums ────────────────────────────────────────────────────────────

const digitsOf = (s: string) => s.replace(/\D/g, '');

export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Issuer prefixes of the common card networks (Visa, Mastercard, Amex, Discover, RuPay, JCB, Diners, Maestro, UnionPay). */
function cardPrefixOk(d: string): boolean {
  return /^(4|5[1-5]|2[2-7]|3[47]|6011|64[4-9]|65|60|81|82|508|35|30[0-5]|36|38|50|5[6-9]|62)/.test(d);
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[digits.length - 1 - i]);
    c = VERHOEFF_D[c]?.[VERHOEFF_P[i % 8]?.[d] ?? 0] ?? 0;
  }
  return c === 0;
}

/** ISO 13616 IBAN check: move the first four characters to the end, letters to numbers, mod 97 = 1. */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const len = IBAN_LENGTHS[s.slice(0, 2)];
  if (len && s.length !== len) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26,
  UA: 29, VG: 24, XK: 20,
};

function ipv4Valid(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && !(p.length > 1 && p.startsWith('0')));
}

// ── Patterns ─────────────────────────────────────────────────────────────
// `\s` includes line breaks, so a number wrapped onto the next line still matches.

type Rule = { category: PiiCategory; re: RegExp; valid?: (m: RegExpExecArray, text: string) => boolean; group?: number };

/** Words before a number that make it a phone number. */
const PHONE_LABEL = /(?<![\p{L}\p{M}])(?:phone|mobile|mob|cell|tel(?:ephone)?|ph|contact(?:\s+no)?|call|whats\s?app|fax|helpline|fon|téléphone|teléfono|telefono|telefone|телефон|फ़ोन|फोन|मोबाइल|दूरभाष|संपर्क)(?![\p{L}\p{M}])\.?\s*(?:no\.?|number|#|nr\.?)?\s*[:.\-–]?\s*$/iu;
/** Words before a number that make it something else (an ID, an amount …). */
const NOT_PHONE_LABEL = /(?<![\p{L}\p{M}])(?:invoice|inv|order|account|a\/c|acct|ref(?:erence)?|txn|transaction|id|serial|s\/n|gstin?|pin(?:\s*code)?|zip|postal|policy|roll|registration|reg|isbn|issn|ifsc|pnr|ticket|case|file|receipt|bill|challan|cheque|check|amount|total|rs\.?|inr|₹|\$|€|£|usd|eur)(?![\p{L}\p{M}])\.?\s*(?:no\.?|number|#|nr\.?)?\s*[:.\-–]?\s*$/iu;

/** The phone verdict from the 40 characters before a candidate. */
function phoneContext(text: string, at: number): 'phone' | 'other' | 'none' {
  const before = text.slice(Math.max(0, at - 40), at);
  if (PHONE_LABEL.test(before)) return 'phone';
  if (NOT_PHONE_LABEL.test(before)) return 'other';
  return 'none';
}

/** A national number without prefix or label counts only in phone-like grouping (98765 43210, 987-654-3210 …). */
function phoneGrouped(raw: string): boolean {
  const groups = raw.split(/[ \t\n\u00a0.-]+/).filter(Boolean).map((g) => g.length);
  if (groups.length === 1) return false;
  const key = groups.join('-');
  return ['5-5', '3-3-4', '4-3-3', '3-4-3', '2-4-4', '4-6', '3-7', '2-2-2-2-2', '4-2-2-2'].includes(key);
}

const SEP = '[ \\t\\n\\u00a0.-]?';

const RULES: Rule[] = [
  {
    category: 'email',
    re: /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,63})@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}\b/g,
  },
  {
    category: 'card',
    re: /(?<![\d-])(?:\d[ \t\n-]?){12,18}\d(?![\d-])/g,
    valid: (m) => {
      const d = digitsOf(m[0]);
      return d.length >= 13 && d.length <= 19 && luhnValid(d) && cardPrefixOk(d) && !/^(\d)\1+$/.test(d);
    },
  },
  {
    category: 'iban',
    re: /\b[A-Z]{2}\d{2}(?:[ \t\n]?[A-Z0-9]){11,30}\b/g,
    valid: (m) => ibanValid(m[0]),
  },
  {
    category: 'aadhaar',
    re: /(?<![\d-])[2-9]\d{3}[ \t\n-]?\d{4}[ \t\n-]?\d{4}(?![\d-])/g,
    valid: (m) => verhoeffValid(digitsOf(m[0])),
  },
  {
    category: 'pan',
    re: /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g,
  },
  {
    category: 'ssn',
    re: /(?<![\d-])(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}(?![\d-])/g,
  },
  {
    category: 'ssn',
    // Nine digits without separators, only after an SSN label.
    re: /(?:\bssn|social\s+security(?:\s+(?:no|number|#))?)\.?\s*(?:no\.?|number|#)?\s*[:#.\-–]?\s*((?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4})(?!\d)/gi,
    group: 1,
  },
  {
    category: 'ip',
    re: /(?<!\d|\d\.)(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g,
    valid: (m) => ipv4Valid(m[0]),
  },
  {
    category: 'ip',
    // Full and compressed IPv6 (at least two groups and one "::" or eight groups).
    re: /(?<![0-9A-Fa-f:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,6}:(?:[0-9A-Fa-f]{1,4}:){0,5}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|::(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4})(?![0-9A-Fa-f:])/g,
    valid: (m) => (m[0].match(/[0-9A-Fa-f]+/g)?.length ?? 0) >= 3,
  },
  {
    category: 'phone',
    // Indian mobiles: 10 digits starting 6–9. With a +91 / 0 prefix, a phone label before it, or phone-like
    // grouping; never after "Invoice no.", "A/c", amounts and other ID labels.
    re: new RegExp(`(?<![\\d+.,/])((?:\\+|00)?91${SEP}|0)?[6-9]\\d(?:${SEP}?\\d){8}(?![\\d.,]\\d|\\d)`, 'g'),
    valid: (m, text) => {
      const context = phoneContext(text, m.index);
      if (context === 'other') return false;
      return !!m[1] || context === 'phone' || phoneGrouped(m[0]);
    },
  },
  {
    category: 'phone',
    // Indian landlines: 0 + 2–4 digit STD code + 6–8 digit number.
    re: /(?<!\d)(?:\+91[ -]?|0)\d{2,4}[ -]\d{6,8}(?!\d)/g,
    valid: (m, text) => digitsOf(m[0]).length >= 10 && phoneContext(text, m.index) !== 'other',
  },
  {
    category: 'phone',
    // UK: 07xxx xxxxxx mobiles and 01/02/03 numbers with the trunk 0.
    re: /(?<![\d+])0(?:7\d{3}[ ]?\d{6}|[123]\d{1,3}[ ]?\d{3,4}[ ]?\d{3,4})(?!\d)/g,
    valid: (m, text) => phoneContext(text, m.index) !== 'other' && digitsOf(m[0]).length >= 10 && digitsOf(m[0]).length <= 11 && (m[0].includes(' ') || phoneContext(text, m.index) === 'phone'),
  },
  {
    category: 'phone',
    // France: 0X XX XX XX XX.
    re: /(?<![\d+])0[1-9](?:[ .]\d{2}){4}(?!\d)/g,
    valid: (m, text) => phoneContext(text, m.index) !== 'other',
  },
  {
    category: 'phone',
    // Any 7–15 digit number right after a phone label ("Tel: 2345 6789").
    re: /(?<![\w+])\(?\d{2,5}\)?(?:[ .-]?\d{2,5}){1,4}(?!\d)/g,
    valid: (m, text) => {
      const n = digitsOf(m[0]).length;
      return n >= 7 && n <= 15 && phoneContext(text, m.index) === 'phone';
    },
  },
  {
    category: 'phone',
    // International: +country code then 6–14 more digits in groups.
    re: /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?!\d)/g,
    valid: (m, text) => {
      const n = digitsOf(m[0]).length;
      return n >= 8 && n <= 15 && phoneContext(text, m.index) !== 'other';
    },
  },
  {
    category: 'phone',
    // North American: (555) 123-4567, 555-123-4567, 555.123.4567 (area and exchange codes do not start with 0 or 1).
    re: /(?<![\d-])(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[-.])[2-9]\d{2}[-.]\d{4}(?![\d-])/g,
    valid: (m, text) => phoneContext(text, m.index) !== 'other',
  },
];

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|' +
  'januar|februar|märz|mai|juni|juli|oktober|dezember|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre|' +
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|' +
  'जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर';
const YEAR = `(?:\\d{4}|'\\d{2})`;
const DATE =
  `(?:\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})` +
  `|\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}` +
  `|\\d{1,2}(?:st|nd|rd|th|\\.)?(?:[ \\t]+of)?[ \\t./-]*(?:${MONTHS})\\.?,?[ \\t./-]*${YEAR}` +
  `|(?:${MONTHS})\\.?[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]+${YEAR}` +
  `|\\d{1,2}[ ]\\d{1,2}[ ]\\d{4}` +
  `|(?<!\\d)\\d{8}(?!\\d))`;
const DOB_LABEL =
  '(?:d\\.?\\s?o\\.?\\s?b\\.?|date\\s+of\\s+birth|birth\\s*date|birthday|born(?:\\s+on)?|' +
  'geburtsdatum|geb\\.|date\\s+de\\s+naissance|né(?:e)?\\s+le|fecha\\s+de\\s+nacimiento|data\\s+di\\s+nascita|data\\s+de\\s+nascimento|дата\\s+рождения|' +
  'जन्म\\s*(?:तिथि|तारीख|दिनांक)?)';
// The label, an optional hint such as "(DD/MM/YYYY)", then the date (also on the next line, as in forms).
const DOB = new RegExp(`${DOB_LABEL}\\s*(?:\\([^)\\n]{0,24}\\))?\\s*[:\\-–]?\\s*(?:on\\s+)?(${DATE})`, 'giu');

/** Labels after which a name follows. */
const NAME_LABEL =
  "(?:(?:full\\s+|first\\s+|last\\s+|sur|given\\s+|patient(?:'s)?\\s+|applicant(?:'s)?\\s+|employee\\s+|customer\\s+|candidate(?:'s)?\\s+|account\\s+holder(?:'s)?\\s+|father(?:'s)?\\s+|mother(?:'s)?\\s+|husband(?:'s)?\\s+|spouse(?:'s)?\\s+|guardian(?:'s)?\\s+|nominee(?:'s)?\\s+)?name|patient|applicant|insured|beneficiary|नाम|पिता\\s+का\\s+नाम)";
/** A regex source with its (unescaped) ASCII letters matching either case: the name itself must stay case-sensitive. */
const anyCase = (src: string) => src.replace(/(?<!\\)[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
/** Up to five capitalised words (initials allowed), or Devanagari words, on the same line. */
const NAME = new RegExp(
  `(?<![\\p{L}])${anyCase(NAME_LABEL)}\\s*[:\\-–]\\s*((?:(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Kumari)\\.?\\s+)?(?:\\p{Lu}[\\p{L}'’-]*\\.?|[\\u0900-\\u097F]+)(?:[ \\t]+(?:\\p{Lu}[\\p{L}'’-]*\\.?|[\\u0900-\\u097F]+|bin|binti|van|von|de|da|del|la|le)){0,4})`,
  'gu',
);
/** Words that end a name (the next label on the same line). */
const NAME_STOP = /^(?:date|dob|d\.o\.b\.?|birth|born|address|phone|mobile|tel|email|e-mail|age|gender|sex|id|no\.?|signature|sign|class|roll|dept|department)$/i;
const ADDRESS = new RegExp(
  `(?<![\\p{L}])(?:(?:residential|permanent|postal|mailing|home|current|correspondence|billing|shipping)\\s+)?(?:address|addr\\.|residing\\s+at|resident\\s+of|r\\/o|पता|adresse|dirección|indirizzo|endereço|anschrift)\\s*[:\\-–]?\\s*([^\\n]{6,160})`,
  'giu',
);

/** Words that follow a label but are not a name. */
const NOT_NAME = /^(?:of|the|and|or|n\/a|na|nil|none|not|same|as|above|below|signature|date|address|number|no|id)$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A user pattern compiled, or the reason it cannot be. */
export function compilePattern(source: string): { re: RegExp | null; error: string | null } {
  try {
    const re = new RegExp(source, 'giu');
    if (re.test('')) return { re: null, error: 'This pattern matches empty text.' };
    return { re, error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : 'Invalid pattern.' };
  }
}

const PRIORITY: Record<PiiCategory, number> = {
  custom: 0,
  email: 1,
  iban: 2,
  card: 3,
  aadhaar: 4,
  pan: 5,
  ssn: 6,
  dob: 7,
  ip: 8,
  phone: 9,
  name: 10,
  address: 11,
};

/**
 * Every match in `text`, overlaps resolved (a validated card number is not
 * also a phone number; your own words win). Sorted by position.
 */
export function detectPii(text: string, opts: DetectOptions): PiiMatch[] {
  const found: PiiMatch[] = [];
  const push = (category: PiiCategory, start: number, end: number) => {
    // Trim separators that patterns may swallow at the edges.
    while (start < end && /[\s.,;:-]/.test(text[start] ?? '')) start += 1;
    while (end > start && /[\s.,;:-]/.test(text[end - 1] ?? '')) end -= 1;
    if (end > start) found.push({ category, start, end, text: text.slice(start, end) });
  };
  for (const rule of RULES) {
    if (!opts.categories.has(rule.category)) continue;
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      if (rule.valid && !rule.valid(m, text)) continue;
      if (rule.group !== undefined && m[rule.group]) {
        const inner = m[rule.group] as string;
        const at = m.index + m[0].lastIndexOf(inner);
        push(rule.category, at, at + inner.length);
      } else push(rule.category, m.index, m.index + m[0].length);
    }
  }
  if (opts.categories.has('dob')) {
    DOB.lastIndex = 0;
    for (let m = DOB.exec(text); m; m = DOB.exec(text)) {
      const date = m[1] ?? '';
      const at = m.index + m[0].lastIndexOf(date);
      push('dob', at, at + date.length);
    }
  }
  if (opts.categories.has('name')) {
    NAME.lastIndex = 0;
    for (let m = NAME.exec(text); m; m = NAME.exec(text)) {
      // Cut at the next label on the line ("Name: Priya Sharma Date of birth …").
      const raw = m[1] ?? '';
      let cut = raw.length;
      for (const w of raw.matchAll(/\S+/g)) {
        if (NAME_STOP.test(w[0])) {
          cut = w.index;
          break;
        }
      }
      const name = raw.slice(0, cut).trim();
      const first = name.replace(/^(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Kumari)\.?\s+/, '').split(/\s+/)[0] ?? '';
      if (!name || NOT_NAME.test(first) || name.length < 2) continue;
      const at = m.index + m[0].lastIndexOf(name);
      push('name', at, at + name.length);
    }
  }
  if (opts.categories.has('address')) {
    ADDRESS.lastIndex = 0;
    for (let m = ADDRESS.exec(text); m; m = ADDRESS.exec(text)) {
      const value = (m[1] ?? '').trim();
      // An address has a number or a comma-separated place in it.
      if (!/\d/.test(value) && !/,/.test(value)) continue;
      const at = m.index + m[0].lastIndexOf(value);
      push('address', at, at + value.length);
    }
  }
  if (opts.categories.has('custom')) {
    for (const word of opts.words ?? []) {
      const w = word.trim();
      if (!w) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
      for (let m = re.exec(text); m; m = re.exec(text)) push('custom', m.index, m.index + m[0].length);
    }
    for (const source of opts.patterns ?? []) {
      const { re } = compilePattern(source);
      if (!re) continue;
      let guard = 0;
      for (let m = re.exec(text); m && guard < 100_000; m = re.exec(text), guard += 1) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        push('custom', m.index, m.index + m[0].length);
      }
    }
  }
  // Resolve overlaps: higher priority first, then longer.
  found.sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: PiiMatch[] = [];
  for (const f of found) {
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}
