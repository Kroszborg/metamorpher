/** The invoice form: types, defaults, JSON import/export and the remembered seller. */
import { newId } from '@/lib/files';
import { normalizeGstin } from './gst';

export type Mode = 'gst' | 'generic';
export type TemplateId = 'modern' | 'classic' | 'minimal';
export type PaperId = 'a4' | 'letter';

export type Party = {
  name: string;
  address: string;
  gstin: string;
  /** GST state code ("27"); for generic invoices unused. */
  state: string;
  phone: string;
  email: string;
  /** Generic mode: VAT / tax number or other registration. */
  taxId: string;
};

export type LineItem = {
  id: string;
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  discount: number;
  discountKind: 'pct' | 'amt';
  taxRate: number;
};

export type Bank = {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  upiId: string;
  /** Put a UPI payment QR code (with the invoice total) on the invoice. */
  upiQr: boolean;
  /** Generic mode: IBAN / SWIFT / routing or other payment lines. */
  other: string;
};

export type Invoice = {
  v: 1;
  mode: Mode;
  template: TemplateId;
  accent: string;
  paper: PaperId;
  title: string;
  number: string;
  date: string;
  dueDate: string;
  reference: string;
  seller: Party;
  buyer: Party;
  shipTo: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  currency: string;
  taxLabel: string;
  items: LineItem[];
  roundOff: boolean;
  hsnSummary: boolean;
  bank: Bank;
  notes: string;
  terms: string;
  /** data: URLs (kept in the saved JSON, never in localStorage). */
  logo: string | null;
  signature: string | null;
  signLabel: string;
};

export const ACCENTS = ['#1f4e79', '#0f766e', '#7c2d12', '#4a6b0a', '#6d28d9', '#111827'] as const;

function iso(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function emptyParty(): Party {
  return { name: '', address: '', gstin: '', state: '', phone: '', email: '', taxId: '' };
}

export function newItem(partial: Partial<LineItem> = {}): LineItem {
  return { id: newId('li'), description: '', hsn: '', qty: 1, unit: '', rate: 0, discount: 0, discountKind: 'pct', taxRate: 18, ...partial };
}

/** Today and today + 15 days as yyyy-mm-dd (local time). */
export function datesFromToday(): { date: string; dueDate: string } {
  const today = new Date();
  return { date: iso(today), dueDate: iso(new Date(today.getTime() + 15 * 86400000)) };
}

/** A new invoice. Dates are empty; the form fills them from the device clock after it mounts. */
export function defaultInvoice(mode: Mode = 'gst'): Invoice {
  return {
    v: 1,
    mode,
    template: 'modern',
    accent: ACCENTS[0],
    paper: 'a4',
    title: mode === 'gst' ? 'Tax Invoice' : 'Invoice',
    number: 'INV-0001',
    date: '',
    dueDate: '',
    reference: '',
    seller: emptyParty(),
    buyer: emptyParty(),
    shipTo: '',
    placeOfSupply: '',
    reverseCharge: false,
    currency: mode === 'gst' ? 'INR' : 'USD',
    taxLabel: mode === 'gst' ? 'GST' : 'Tax',
    items: [newItem({ taxRate: mode === 'gst' ? 18 : 0 })],
    roundOff: mode === 'gst',
    hsnSummary: true,
    bank: { accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '', upiId: '', upiQr: false, other: '' },
    notes: 'Thank you for your business.',
    terms: '',
    logo: null,
    signature: null,
    signLabel: 'Authorised Signatory',
  };
}

// ── JSON ────────────────────────────────────────────────────────────────────

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const dataUrl = (v: unknown): string | null => (typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null);

function party(v: unknown): Party {
  const o = obj(v);
  return {
    name: str(o.name),
    address: str(o.address),
    gstin: normalizeGstin(str(o.gstin)),
    state: str(o.state),
    phone: str(o.phone),
    email: str(o.email),
    taxId: str(o.taxId),
  };
}

/** Reads a saved invoice (our JSON), filling anything missing with defaults. Throws on non-invoices. */
export function parseInvoice(text: string): Invoice {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const o = obj(raw);
  if (o.kind !== 'metamorpher-invoice') throw new Error('This JSON is not an invoice saved by this tool.');
  const mode: Mode = o.mode === 'generic' ? 'generic' : 'gst';
  const d = defaultInvoice(mode);
  const b = obj(o.bank);
  const items = Array.isArray(o.items)
    ? o.items.slice(0, 500).map((x) => {
        const i = obj(x);
        return newItem({
          description: str(i.description),
          hsn: str(i.hsn),
          qty: num(i.qty, 1),
          unit: str(i.unit),
          rate: num(i.rate),
          discount: num(i.discount),
          discountKind: i.discountKind === 'amt' ? 'amt' : 'pct',
          taxRate: num(i.taxRate),
        });
      })
    : d.items;
  const template = (['modern', 'classic', 'minimal'] as const).find((t) => t === o.template) ?? d.template;
  return {
    v: 1,
    mode,
    template,
    accent: /^#[0-9a-fA-F]{6}$/.test(str(o.accent)) ? str(o.accent) : d.accent,
    paper: o.paper === 'letter' ? 'letter' : 'a4',
    title: str(o.title, d.title),
    number: str(o.number, d.number),
    date: str(o.date, d.date),
    dueDate: str(o.dueDate),
    reference: str(o.reference),
    seller: party(o.seller),
    buyer: party(o.buyer),
    shipTo: str(o.shipTo),
    placeOfSupply: str(o.placeOfSupply),
    reverseCharge: bool(o.reverseCharge),
    currency: str(o.currency, d.currency),
    taxLabel: str(o.taxLabel, d.taxLabel),
    items: items.length ? items : d.items,
    roundOff: bool(o.roundOff, d.roundOff),
    hsnSummary: bool(o.hsnSummary, true),
    bank: {
      accountName: str(b.accountName),
      accountNumber: str(b.accountNumber),
      ifsc: str(b.ifsc),
      bankName: str(b.bankName),
      branch: str(b.branch),
      upiId: str(b.upiId),
      upiQr: bool(b.upiQr),
      other: str(b.other),
    },
    notes: str(o.notes),
    terms: str(o.terms),
    logo: dataUrl(o.logo),
    signature: dataUrl(o.signature),
    signLabel: str(o.signLabel, d.signLabel),
  };
}

export function serializeInvoice(inv: Invoice): string {
  const { items, ...rest } = inv;
  return JSON.stringify(
    { kind: 'metamorpher-invoice', ...rest, items: items.map(({ id: _id, ...i }) => i) },
    null,
    2,
  );
}

// ── Remembered seller (opt-in) ───────────────────────────────────────────────

const SELLER_KEY = 'metamorpher:invoice-seller';

/** What is remembered: the seller's text details and bank lines. Never the logo or signature. */
export type Remembered = { seller: Party; bank: Omit<Bank, 'upiQr'>; terms: string; signLabel: string };

export function loadRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(SELLER_KEY);
    if (!raw) return null;
    const o = obj(JSON.parse(raw));
    const b = obj(o.bank);
    return {
      seller: party(o.seller),
      bank: {
        accountName: str(b.accountName),
        accountNumber: str(b.accountNumber),
        ifsc: str(b.ifsc),
        bankName: str(b.bankName),
        branch: str(b.branch),
        upiId: str(b.upiId),
        other: str(b.other),
      },
      terms: str(o.terms),
      signLabel: str(o.signLabel, 'Authorised Signatory'),
    };
  } catch {
    return null;
  }
}

export function saveRemembered(inv: Invoice): void {
  const { upiQr: _q, ...bank } = inv.bank;
  try {
    localStorage.setItem(SELLER_KEY, JSON.stringify({ seller: inv.seller, bank, terms: inv.terms, signLabel: inv.signLabel }));
  } catch {
    // Storage blocked: nothing is remembered.
  }
}

export function clearRemembered(): void {
  try {
    localStorage.removeItem(SELLER_KEY);
  } catch {
    // ignore
  }
}
