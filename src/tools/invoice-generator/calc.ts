/**
 * Invoice arithmetic in integer minor units (paise, cents), so totals never
 * drift. GST: tax is worked out per line on the taxable value (after
 * discount); intra-state supplies split it into CGST + SGST (UTGST in union
 * territories without a legislature), each half rounded to the paisa;
 * inter-state supplies and exports carry IGST.
 */
import { currencyInfo, percentOf, productMinor, toMinor } from '@/components/business/money';
import { gstState } from './gst';
import type { Invoice } from './model';

export type LineCalc = {
  gross: number;
  discount: number;
  taxable: number;
  /** Tax rate in percent. */
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
};

export type TaxGroup = { key: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };

export type Totals = {
  digits: number;
  lines: LineCalc[];
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  beforeRound: number;
  roundOff: number;
  total: number;
  /** GST: same state (CGST + SGST/UTGST). */
  intra: boolean;
  /** Second half labelled UTGST. */
  utgst: boolean;
  byRate: TaxGroup[];
  byHsn: TaxGroup[];
};

/** Supplier's state: from the GSTIN when it is there, otherwise the chosen state. */
export function sellerState(inv: Invoice): string {
  return /^\d{2}/.test(inv.seller.gstin) ? inv.seller.gstin.slice(0, 2) : inv.seller.state;
}

/** Place of supply: chosen, or the buyer's state (GSTIN first). */
export function placeOfSupply(inv: Invoice): string {
  if (inv.placeOfSupply) return inv.placeOfSupply;
  if (/^\d{2}/.test(inv.buyer.gstin)) return inv.buyer.gstin.slice(0, 2);
  return inv.buyer.state;
}

export function isIntraState(inv: Invoice): boolean {
  const from = sellerState(inv);
  const to = placeOfSupply(inv);
  if (!from || !to) return true;
  if (to === '96') return false;
  return from === to;
}

function group(map: Map<string, TaxGroup>, key: string, rate: number, l: LineCalc) {
  let g = map.get(key);
  if (!g) {
    g = { key, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    map.set(key, g);
  }
  g.taxable += l.taxable;
  g.cgst += l.cgst;
  g.sgst += l.sgst;
  g.igst += l.igst;
  g.tax += l.tax;
}

export function computeTotals(inv: Invoice): Totals {
  const digits = inv.mode === 'gst' ? 2 : currencyInfo(inv.currency).digits;
  const gst = inv.mode === 'gst';
  const intra = gst && isIntraState(inv);
  const utgst = intra && !!gstState(placeOfSupply(inv) || sellerState(inv))?.ut;
  const lines: LineCalc[] = [];
  const byRate = new Map<string, TaxGroup>();
  const byHsn = new Map<string, TaxGroup>();
  const f = 10 ** digits;
  for (const it of inv.items) {
    const qty = Number.isFinite(it.qty) ? it.qty : 0;
    const rate = Number.isFinite(it.rate) ? it.rate : 0;
    const gross = productMinor(qty, rate, digits);
    let discount = 0;
    if (it.discount > 0) {
      discount = it.discountKind === 'pct' ? percentOf(gross, Math.min(100, it.discount)) : toMinor(it.discount, digits);
      if (Math.abs(discount) > Math.abs(gross)) discount = gross;
    }
    const taxable = gross - discount;
    const taxRate = Math.max(0, Number.isFinite(it.taxRate) ? it.taxRate : 0);
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (gst && intra) {
      cgst = percentOf(taxable, taxRate, 2);
      sgst = cgst;
    } else {
      igst = percentOf(taxable, taxRate);
    }
    const tax = cgst + sgst + igst;
    const l: LineCalc = { gross, discount, taxable, rate: taxRate, cgst, sgst, igst, tax, total: taxable + tax };
    lines.push(l);
    group(byRate, String(taxRate), taxRate, l);
    group(byHsn, `${it.hsn.trim() || '—'}|${taxRate}`, taxRate, l);
  }
  const sum = (k: keyof LineCalc) => lines.reduce((a, l) => a + l[k], 0);
  const taxable = sum('taxable');
  const tax = sum('tax');
  const beforeRound = taxable + tax;
  const total = inv.roundOff ? Math.sign(beforeRound) * Math.round(Math.abs(beforeRound) / f) * f : beforeRound;
  return {
    digits,
    lines,
    gross: sum('gross'),
    discount: sum('discount'),
    taxable,
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    tax,
    beforeRound,
    roundOff: total - beforeRound,
    total,
    intra,
    utgst,
    byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    byHsn: [...byHsn.values()],
  };
}

/** "18" / "0.25" / "8.875" (percent). */
export function rateText(rate: number): string {
  return String(Math.round(rate * 10000) / 10000);
}
