/** Money helpers for the business tools: integer minor units, formatting and amounts in words. */

export type CurrencyInfo = { code: string; symbol: string; name: string; minor: string; locale: string; digits: number };

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'INR', symbol: '₹', name: 'Rupees', minor: 'Paise', locale: 'en-IN', digits: 2 },
  { code: 'USD', symbol: '$', name: 'Dollars', minor: 'Cents', locale: 'en-US', digits: 2 },
  { code: 'EUR', symbol: '€', name: 'Euros', minor: 'Cents', locale: 'en-IE', digits: 2 },
  { code: 'GBP', symbol: '£', name: 'Pounds', minor: 'Pence', locale: 'en-GB', digits: 2 },
  { code: 'AED', symbol: 'AED', name: 'Dirhams', minor: 'Fils', locale: 'en-AE', digits: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollars', minor: 'Cents', locale: 'en-SG', digits: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollars', minor: 'Cents', locale: 'en-AU', digits: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollars', minor: 'Cents', locale: 'en-CA', digits: 2 },
  { code: 'JPY', symbol: '¥', name: 'Yen', minor: '', locale: 'ja-JP', digits: 0 },
  { code: 'CHF', symbol: 'CHF', name: 'Francs', minor: 'Rappen', locale: 'de-CH', digits: 2 },
  { code: 'NPR', symbol: 'Rs', name: 'Nepalese Rupees', minor: 'Paisa', locale: 'en-IN', digits: 2 },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupees', minor: 'Cents', locale: 'en-IN', digits: 2 },
  { code: 'BDT', symbol: '৳', name: 'Taka', minor: 'Poisha', locale: 'en-IN', digits: 2 },
  { code: 'ZAR', symbol: 'R', name: 'Rand', minor: 'Cents', locale: 'en-ZA', digits: 2 },
];

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? (CURRENCIES[0] as CurrencyInfo);
}

/** Rounds to integer minor units (paise, cents), half away from zero, without float drift. */
export function toMinor(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  // toFixed-free: scale, then nudge by a tiny epsilon so 1.005 → 101 not 100.
  const scaled = value * f;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-7);
}

/** A finite number as an exact decimal: 12.345 → { int: 12345n, scale: 3 }. */
export function decimal(n: number): { int: bigint; scale: number } {
  if (!Number.isFinite(n)) return { int: 0n, scale: 0 };
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [w, f = ''] = s.split('.');
  const int = BigInt(`${w}${f}` || '0');
  return { int: neg ? -int : int, scale: f.length };
}

/** n / d rounded half away from zero, exactly (BigInt). */
function roundDiv(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (2n * ad);
  return neg ? -q : q;
}

/** a × b in minor units (qty × rate), exact decimal arithmetic, rounded half away from zero. */
export function productMinor(a: number, b: number, digits = 2): number {
  const x = decimal(a);
  const y = decimal(b);
  const scale = x.scale + y.scale - digits;
  const p = x.int * y.int;
  return Number(scale >= 0 ? roundDiv(p, 10n ** BigInt(scale)) : p * 10n ** BigInt(-scale));
}

/** `percent`% of an amount in minor units, divided further by `parts` (2 for CGST/SGST halves), rounded exactly. */
export function percentOf(minor: number, percent: number, parts = 1): number {
  const r = decimal(percent);
  return Number(roundDiv(BigInt(Math.round(minor)) * r.int, 100n * BigInt(parts) * 10n ** BigInt(r.scale)));
}

/** 123456789 (minor units) → "12,34,567.89" (en-IN) or "1,234,567.89". */
export function formatMinor(minor: number, info: Pick<CurrencyInfo, 'locale' | 'digits'>): string {
  const value = minor / 10 ** info.digits;
  return new Intl.NumberFormat(info.locale, { minimumFractionDigits: info.digits, maximumFractionDigits: info.digits }).format(value);
}

/** A quantity or rate as typed, without trailing zeros: 2 → "2", 1.5 → "1.5". */
export function formatNumber(value: number, locale = 'en-IN', max = 3): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(value);
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–999 in words ("Four Hundred Fifty-Six"); '' for 0. */
function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest] as string);
    else parts.push(`${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ''}`);
  }
  return parts.join(' ');
}

/**
 * Whole numbers in words with the Indian system: thousand, lakh (1,00,000),
 * crore (1,00,00,000). Amounts above 99 crore repeat the system
 * ("One Hundred Twenty-Three Crore …"), as cheques and invoices write them.
 */
export function indianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

/** Whole numbers in words with the international system (thousand, million, billion, trillion). */
export function westernWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${under1000(chunk)}${scales[i] ? ` ${scales[i]}` : ''}`);
    n = Math.floor(n / 1000);
    i += 1;
  }
  return parts.join(' ');
}

/**
 * An amount (minor units) in words for invoices:
 * INR → "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Seventy-Eight Paise Only";
 * others → "One Thousand Two Hundred Dollars and Five Cents Only".
 */
export function amountInWords(minor: number, info: CurrencyInfo): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const f = 10 ** info.digits;
  const whole = Math.floor(abs / f);
  const fraction = abs % f;
  const indian = info.locale === 'en-IN';
  const words = indian ? indianWords : westernWords;
  let s: string;
  if (info.code === 'INR') {
    s = `Rupees ${words(whole)}`;
    if (fraction) s += ` and ${words(fraction)} Paise`;
  } else {
    s = `${words(whole)} ${info.name}`;
    if (fraction && info.minor) s += ` and ${words(fraction)} ${info.minor}`;
  }
  return `${negative ? 'Minus ' : ''}${s} Only`;
}
