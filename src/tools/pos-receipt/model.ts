/** POS receipt: form model, arithmetic (integer minor units) and JSON. */
import { currencyInfo, percentOf, productMinor, toMinor } from '@/components/business/money';
import { newId } from '@/lib/files';

export type PaperWidth = '58' | '80';
export type TaxMode = 'none' | 'exclusive' | 'inclusive';
export type QrKind = 'none' | 'upi' | 'text';

export type ReceiptItem = { id: string; name: string; qty: number; rate: number; taxRate: number };

export type Receipt = {
  v: 1;
  paper: PaperWidth;
  font: 'mono' | 'sans';
  shopName: string;
  shopLines: string;
  gstin: string;
  billNo: string;
  date: string;
  cashier: string;
  customer: string;
  currency: string;
  items: ReceiptItem[];
  taxMode: TaxMode;
  /** Show tax as CGST + SGST halves (India) or one line with `taxLabel`. */
  gstSplit: boolean;
  taxLabel: string;
  discount: number;
  discountKind: 'pct' | 'amt';
  roundOff: boolean;
  payment: string;
  tendered: number;
  footer: string;
  qrKind: QrKind;
  /** UPI ID for `upi`, any text or link for `text`. */
  qrValue: string;
  qrCaption: string;
};

export function newReceiptItem(p: Partial<ReceiptItem> = {}): ReceiptItem {
  return { id: newId('ri'), name: '', qty: 1, rate: 0, taxRate: 5, ...p };
}

/** The current local date and time as a datetime-local value. */
export function nowLocal(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function defaultReceipt(): Receipt {
  return {
    v: 1,
    paper: '80',
    font: 'mono',
    shopName: 'Your Shop',
    shopLines: 'Shop address, city\nPh: 98765 43210',
    gstin: '',
    billNo: '1001',
    date: '',
    cashier: '',
    customer: '',
    currency: 'INR',
    items: [newReceiptItem({ name: 'Item', qty: 1, rate: 100 })],
    taxMode: 'inclusive',
    gstSplit: true,
    taxLabel: 'GST',
    discount: 0,
    discountKind: 'pct',
    roundOff: true,
    payment: 'Cash',
    tendered: 0,
    footer: 'Thank you! Visit again.',
    qrKind: 'none',
    qrValue: '',
    qrCaption: 'Scan to pay',
  };
}

export type RateGroup = { rate: number; taxable: number; tax: number; half1: number; half2: number };

export type ReceiptTotals = {
  digits: number;
  lines: { gross: number; amount: number }[];
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  groups: RateGroup[];
  beforeRound: number;
  roundOff: number;
  total: number;
  tendered: number;
  change: number;
  quantity: number;
};

/**
 * Discount comes off the subtotal and is shared across lines in proportion
 * (the last line takes the remainder), so tax is charged on what is paid.
 * Exclusive: tax added on top. Inclusive: prices contain tax, which is backed
 * out per rate (taxable = amount × 100 / (100 + rate)).
 */
export function computeReceipt(r: Receipt): ReceiptTotals {
  const digits = currencyInfo(r.currency).digits;
  const f = 10 ** digits;
  const lines = r.items.map((it) => {
    const gross = productMinor(Number.isFinite(it.qty) ? it.qty : 0, Number.isFinite(it.rate) ? it.rate : 0, digits);
    return { gross, amount: gross };
  });
  const subtotal = lines.reduce((a, l) => a + l.gross, 0);
  let discount = 0;
  if (r.discount > 0 && subtotal > 0) {
    discount = r.discountKind === 'pct' ? percentOf(subtotal, Math.min(100, r.discount)) : Math.min(subtotal, toMinor(r.discount, digits));
  }
  // Share the discount out.
  let left = discount;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round((discount * l.gross) / (subtotal || 1));
    l.amount = l.gross - share;
    left -= share;
  });
  const groups = new Map<number, RateGroup>();
  let taxable = 0;
  let tax = 0;
  r.items.forEach((it, i) => {
    const amount = (lines[i] as { amount: number }).amount;
    const rate = r.taxMode === 'none' ? 0 : Math.max(0, it.taxRate || 0);
    let t = 0;
    let base = amount;
    if (r.taxMode === 'exclusive') t = percentOf(amount, rate);
    else if (r.taxMode === 'inclusive' && rate > 0) {
      base = Math.round((amount * 100) / (100 + rate));
      t = amount - base;
    }
    taxable += base;
    tax += t;
    let g = groups.get(rate);
    if (!g) {
      g = { rate, taxable: 0, tax: 0, half1: 0, half2: 0 };
      groups.set(rate, g);
    }
    g.taxable += base;
    g.tax += t;
  });
  for (const g of groups.values()) {
    g.half1 = Math.round(g.tax / 2);
    g.half2 = g.tax - g.half1;
  }
  const beforeRound = r.taxMode === 'exclusive' ? subtotal - discount + tax : subtotal - discount;
  const total = r.roundOff ? Math.round(beforeRound / f) * f : beforeRound;
  const tendered = toMinor(r.tendered || 0, digits);
  return {
    digits,
    lines,
    subtotal,
    discount,
    taxable,
    tax,
    groups: [...groups.values()].filter((g) => g.rate > 0).sort((a, b) => a.rate - b.rate),
    beforeRound,
    roundOff: total - beforeRound,
    total,
    tendered,
    change: tendered > 0 ? tendered - total : 0,
    quantity: r.items.reduce((a, it) => a + (Number.isFinite(it.qty) ? it.qty : 0), 0),
  };
}

// ── JSON ──────────────────────────────────────────────────────────────────

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function serializeReceipt(r: Receipt): string {
  return JSON.stringify({ kind: 'metamorpher-receipt', ...r, items: r.items.map(({ id: _id, ...i }) => i) }, null, 2);
}

export function parseReceipt(text: string): Receipt {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.kind !== 'metamorpher-receipt') throw new Error('This JSON is not a receipt saved by this tool.');
  const d = defaultReceipt();
  const items = Array.isArray(o.items)
    ? o.items.slice(0, 300).map((x) => {
        const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        return newReceiptItem({ name: str(i.name), qty: num(i.qty, 1), rate: num(i.rate), taxRate: num(i.taxRate) });
      })
    : d.items;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.find((a) => a === v) ?? fallback);
  return {
    v: 1,
    paper: pick(o.paper, ['58', '80'] as const, d.paper),
    font: pick(o.font, ['mono', 'sans'] as const, d.font),
    shopName: str(o.shopName, d.shopName),
    shopLines: str(o.shopLines),
    gstin: str(o.gstin),
    billNo: str(o.billNo),
    date: str(o.date, d.date),
    cashier: str(o.cashier),
    customer: str(o.customer),
    currency: str(o.currency, d.currency),
    items: items.length ? items : d.items,
    taxMode: pick(o.taxMode, ['none', 'exclusive', 'inclusive'] as const, d.taxMode),
    gstSplit: bool(o.gstSplit, d.gstSplit),
    taxLabel: str(o.taxLabel, d.taxLabel),
    discount: num(o.discount),
    discountKind: o.discountKind === 'amt' ? 'amt' : 'pct',
    roundOff: bool(o.roundOff, d.roundOff),
    payment: str(o.payment, d.payment),
    tendered: num(o.tendered),
    footer: str(o.footer),
    qrKind: pick(o.qrKind, ['none', 'upi', 'text'] as const, 'none'),
    qrValue: str(o.qrValue),
    qrCaption: str(o.qrCaption, d.qrCaption),
  };
}
