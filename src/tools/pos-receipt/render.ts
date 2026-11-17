/** Receipt → HTML + CSS for the typeset engine and the preview (thermal paper widths). */
import { breakLigatures, cellWidth, esc, lines, pt } from '@/components/business/html';
import { currencyInfo, formatMinor, formatNumber } from '@/components/business/money';
import type { Receipt, ReceiptTotals } from './model';

const MM = 72 / 25.4;

/** Paper width, side margin (printers leave ~4–5 mm unprinted) and base font size, in points. */
export const PAPERS = {
  '58': { width: 58 * MM, side: 4 * MM, font: 7.6, label: '58 mm' },
  '80': { width: 80 * MM, side: 4 * MM, font: 8.4, label: '80 mm' },
} as const;
export const TOP = 3 * MM;
export const BOTTOM = 5 * MM;

function when(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return local;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

export function renderReceipt(r: Receipt, t: ReceiptTotals, qr: string | null): { body: string; css: string; width: number; side: number; font: number } {
  const p = PAPERS[r.paper];
  const W = p.width - 2 * p.side;
  const cur = currencyInfo(r.currency);
  const money = (m: number) => formatMinor(m, { locale: cur.locale, digits: t.digits });
  const narrow = r.paper === '58';
  const out: string[] = [];

  out.push(`<div class="c shop">${esc(r.shopName.trim() || 'Shop')}</div>`);
  if (r.shopLines.trim()) out.push(`<div class="c small">${lines(r.shopLines)}</div>`);
  if (r.gstin.trim()) out.push(`<div class="c small">GSTIN: ${esc(r.gstin.trim().toUpperCase())}</div>`);
  out.push('<div class="rule"></div>');

  const meta: [string, string][] = [];
  if (r.billNo.trim()) meta.push(['Bill no', r.billNo.trim()]);
  if (r.date) meta.push(['Date', when(r.date)]);
  if (r.cashier.trim()) meta.push(['Cashier', r.cashier.trim()]);
  if (r.customer.trim()) meta.push(['Customer', r.customer.trim()]);
  if (meta.length) {
    out.push(
      `<table>${meta
        .map(([k, v]) => `<tr><td style="width:${pt(W * 0.36)}">${esc(k)}</td><td class="r" style="width:${pt(W * 0.64)}">${esc(v)}</td></tr>`)
        .join('')}</table><div class="rule"></div>`,
    );
  }

  // Items
  if (narrow) {
    let rows = `<tr class="h"><td style="width:${pt(W * 0.6)}">Item</td><td class="r" style="width:${pt(W * 0.4)}">Amount</td></tr>`;
    r.items.forEach((it, i) => {
      const l = t.lines[i];
      if (!l) return;
      rows += `<tr><td colspan="2" class="nm">${esc(it.name.trim() || '—')}</td></tr>`;
      rows += `<tr><td class="q" style="width:${pt(W * 0.6)}">${formatNumber(it.qty, cur.locale)} x ${money(Math.round(it.rate * 10 ** t.digits))}</td><td class="r" style="width:${pt(W * 0.4)}">${money(l.gross)}</td></tr>`;
    });
    out.push(`<table class="items">${rows}</table>`);
  } else {
    const qW = 30;
    const rW = 50;
    const aW = 56;
    const nW = W - qW - rW - aW;
    const td = (w: number, cls: string, html: string) => `<td class="${cls}" style="width:${cellWidth(w, 1)}">${html}</td>`;
    let rows = `<tr class="h">${td(nW, '', 'Item')}${td(qW, 'r', 'Qty')}${td(rW, 'r', 'Rate')}${td(aW, 'r', 'Amount')}</tr>`;
    r.items.forEach((it, i) => {
      const l = t.lines[i];
      if (!l) return;
      rows += `<tr>${td(nW, 'nm', esc(it.name.trim() || '—'))}${td(qW, 'r', formatNumber(it.qty, cur.locale))}${td(rW, 'r', money(Math.round(it.rate * 10 ** t.digits)))}${td(aW, 'r', money(l.gross))}</tr>`;
    });
    out.push(`<table class="items">${rows}</table>`);
  }
  out.push('<div class="rule"></div>');

  // Totals
  const sums: [string, string, string?][] = [];
  const itemsCount = `${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}, qty ${formatNumber(t.quantity, cur.locale)}`;
  sums.push([`Subtotal`, money(t.subtotal)]);
  if (t.discount) sums.push([`Discount${r.discountKind === 'pct' ? ` ${formatNumber(r.discount, cur.locale)}%` : ''}`, `-${money(t.discount)}`]);
  if (r.taxMode !== 'none' && t.groups.length) {
    if (r.taxMode === 'inclusive') sums.push([`Taxable value`, money(t.taxable), 'muted']);
    for (const g of t.groups) {
      if (r.gstSplit) {
        sums.push([`CGST @ ${formatNumber(g.rate / 2, 'en', 3)}%`, money(g.half1), r.taxMode === 'inclusive' ? 'muted' : undefined]);
        sums.push([`SGST @ ${formatNumber(g.rate / 2, 'en', 3)}%`, money(g.half2), r.taxMode === 'inclusive' ? 'muted' : undefined]);
      } else {
        sums.push([`${r.taxLabel.trim() || 'Tax'} @ ${formatNumber(g.rate, 'en', 3)}%`, money(g.tax), r.taxMode === 'inclusive' ? 'muted' : undefined]);
      }
    }
  }
  if (r.roundOff && t.roundOff) sums.push(['Round off', `${t.roundOff > 0 ? '+' : '-'}${money(Math.abs(t.roundOff))}`]);
  const half = (cls: string | undefined, k: string, v: string) =>
    `<tr${cls ? ` class="${cls}"` : ''}><td style="width:${pt(W * 0.6)}">${esc(k)}</td><td class="r" style="width:${pt(W * 0.4)}">${v}</td></tr>`;
  out.push(`<table>${sums.map(([k, v, cls]) => half(cls, k, v)).join('')}</table>`);
  out.push('<div class="rule"></div>');
  out.push(`<table><tr class="total"><td style="width:${pt(W * 0.45)}">TOTAL</td><td class="r" style="width:${pt(W * 0.55)}">${esc(cur.symbol)} ${money(t.total)}</td></tr></table>`);
  if (r.taxMode === 'inclusive' && t.tax) out.push(`<div class="small c">Prices include tax</div>`);
  out.push(`<div class="small c">${esc(itemsCount)}</div>`);
  out.push('<div class="rule"></div>');

  const pay: [string, string][] = [];
  if (r.payment.trim()) pay.push(['Paid by', r.payment.trim()]);
  if (t.tendered > 0) {
    pay.push(['Tendered', money(t.tendered)]);
    pay.push(['Change', money(Math.max(0, t.change))]);
  }
  if (pay.length) out.push(`<table>${pay.map(([k, v]) => half(undefined, k, esc(v))).join('')}</table>`);

  if (qr) {
    const size = Math.min(W * 0.62, 34 * MM);
    out.push(`<div class="c qr"><img src="${qr}" style="width:${pt(size)};height:${pt(size)}"></div>`);
    if (r.qrCaption.trim()) out.push(`<div class="c small">${esc(r.qrCaption.trim())}</div>`);
  }
  if (r.footer.trim()) out.push(`<div class="c foot">${lines(r.footer)}</div>`);

  const family = r.font === 'mono' ? 'monospace' : 'sans-serif';
  const css = `
body{font-family:${family};font-size:${p.font}pt;line-height:1.3;color:#000;margin:0}
table{border-collapse:collapse;margin:0}
td{padding:0.6pt 0;vertical-align:top}
.c{text-align:center}
.r{text-align:right}
.shop{font-size:${(p.font * 1.55).toFixed(1)}pt;font-weight:bold;line-height:1.2;margin:0 0 2pt}
.small{font-size:${(p.font * 0.92).toFixed(1)}pt}
.rule{border-top:0.8pt dashed #000;margin:3pt 0;height:0}
table.items tr.h td{font-weight:bold}
table.items td.nm{padding-top:1.5pt}
table.items td.q{color:#000}
tr.muted td{color:#333}
tr.total td{font-size:${(p.font * 1.35).toFixed(1)}pt;font-weight:bold}
.qr{margin:6pt 0 1pt}
.foot{margin-top:6pt;font-size:${p.font}pt}
`;
  return { body: breakLigatures(out.join('')), css, width: p.width, side: p.side, font: p.font };
}
