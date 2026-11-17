/**
 * Invoice → HTML + CSS for the typeset engine (and the same markup for the
 * on-screen preview). MuPDF's layout has no floats, flexbox or percentage
 * cell widths, so everything is tables with widths in points.
 */
import { breakLigatures, cellWidth, esc, fitBox, lines, pt, type SizedImage } from '@/components/business/html';
import { amountInWords, currencyInfo, formatMinor, formatNumber } from '@/components/business/money';
import { rateText, placeOfSupply, sellerState, type Totals } from './calc';
import { stateLabel } from './gst';
import type { Invoice, TemplateId } from './model';

export const PAPER = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } } as const;
export const MARGIN = 36;
const PAD = 4;

export type InvoiceAssets = { logo: SizedImage | null; signature: SizedImage | null; qr: string | null };

export const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: 'modern', label: 'Modern', hint: 'Accent header, airy rows' },
  { id: 'classic', label: 'Classic', hint: 'Boxed grid, the traditional GST layout' },
  { id: 'minimal', label: 'Minimal', hint: 'Hairlines and lots of white space' },
];

function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]} ${months[Number(m[2]) - 1] ?? ''} ${m[1]}`;
}

/** Mixes a hex colour with white: 0 = colour, 1 = white. */
function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

type Col = { key: string; label: string; width: number; align: 'left' | 'right' | 'center' };

export function renderInvoice(inv: Invoice, t: Totals, a: InvoiceAssets): { body: string; css: string; width: number; height: number } {
  const gst = inv.mode === 'gst';
  const cur = currencyInfo(gst ? 'INR' : inv.currency);
  const money = (minor: number) => formatMinor(minor, { locale: cur.locale, digits: t.digits });
  const paper = PAPER[inv.paper];
  const W = paper.width - 2 * MARGIN;
  const tpl = inv.template;
  const grid = tpl === 'classic';
  const border = grid ? 0.75 : 0;
  const accent = inv.accent;
  const showTax = gst || t.lines.some((l) => l.rate > 0);
  const anyDiscount = t.lines.some((l) => l.discount !== 0);
  const anyHsn = gst || inv.items.some((i) => i.hsn.trim());
  const taxName = gst ? 'GST' : inv.taxLabel.trim() || 'Tax';
  const half2 = t.utgst ? 'UTGST' : 'SGST';

  // ── Header ────────────────────────────────────────────────────────────────
  const s = inv.seller;
  const sellerLines: string[] = [];
  if (s.address.trim()) sellerLines.push(lines(s.address));
  if (gst && s.gstin) sellerLines.push(`GSTIN: <b>${esc(s.gstin)}</b>`);
  if (gst && sellerState(inv)) sellerLines.push(`State: ${esc(stateLabel(sellerState(inv)))}`);
  if (!gst && s.taxId.trim()) sellerLines.push(esc(s.taxId));
  const contact = [s.phone.trim(), s.email.trim()].filter(Boolean).map(esc).join(' &#183; ');
  if (contact) sellerLines.push(contact);

  const logo = a.logo ? fitBox(a.logo.width, a.logo.height, 150, 52) : null;
  const logoHtml = a.logo && logo ? `<img src="${a.logo.src}" style="width:${pt(logo.w)};height:${pt(logo.h)}">` : '';

  const meta: [string, string][] = [[gst ? 'Invoice no.' : 'Invoice no.', inv.number]];
  if (inv.date) meta.push(['Date', dateText(inv.date)]);
  if (inv.dueDate) meta.push(['Due date', dateText(inv.dueDate)]);
  if (inv.reference.trim()) meta.push(['Reference', inv.reference.trim()]);
  if (gst) {
    const pos = placeOfSupply(inv);
    if (pos) meta.push(['Place of supply', stateLabel(pos)]);
    meta.push(['Reverse charge', inv.reverseCharge ? 'Yes' : 'No']);
  }
  const title = (inv.title.trim() || 'Invoice').toUpperCase();
  const metaHtml = meta.map(([k, v]) => `<div class="meta"><span class="mk">${esc(k)}</span>&#160;&#160;<b>${esc(v)}</b></div>`).join('');

  let header: string;
  const leftW = W * 0.56;
  const rightW = W - leftW;
  const sellerBlock = `${logoHtml ? `<div class="logo">${logoHtml}</div>` : ''}<div class="sname">${esc(s.name.trim() || 'Your business name')}</div><div class="small">${sellerLines.join('<br>')}</div>`;
  if (grid) {
    header =
      `<table class="box"><tr><td class="ttl" style="width:${cellWidth(W, PAD, border)}">${esc(title)}</td></tr></table>` +
      `<table class="box"><tr><td style="width:${cellWidth(leftW, 6, border)}">${sellerBlock}</td><td style="width:${cellWidth(rightW, 6, border)}">${metaHtml}</td></tr></table>`;
  } else {
    header =
      (tpl === 'modern' ? `<div class="bar"></div>` : '') +
      `<table class="head"><tr><td style="width:${pt(leftW)}">${sellerBlock}</td><td class="r" style="width:${pt(rightW)}"><div class="ttl">${esc(title)}</div>${metaHtml}</td></tr></table>`;
  }

  // ── Parties ───────────────────────────────────────────────────────────────
  const b = inv.buyer;
  const buyerLines: string[] = [`<div class="pname">${esc(b.name.trim() || '—')}</div>`];
  if (b.address.trim()) buyerLines.push(`<div>${lines(b.address)}</div>`);
  if (gst && b.gstin) buyerLines.push(`<div>GSTIN: <b>${esc(b.gstin)}</b></div>`);
  if (gst && (b.state || /^\d{2}/.test(b.gstin))) buyerLines.push(`<div>State: ${esc(stateLabel(/^\d{2}/.test(b.gstin) ? b.gstin.slice(0, 2) : b.state))}</div>`);
  if (!gst && b.taxId.trim()) buyerLines.push(`<div>${esc(b.taxId)}</div>`);
  const bContact = [b.phone.trim(), b.email.trim()].filter(Boolean).map(esc).join(' &#183; ');
  if (bContact) buyerLines.push(`<div>${bContact}</div>`);
  const partyCells: [string, string][] = [['Bill to', buyerLines.join('')]];
  if (inv.shipTo.trim()) partyCells.push(['Ship to', `<div>${lines(inv.shipTo)}</div>`]);
  const pw = W / partyCells.length;
  const parties = `<table class="${grid ? 'box' : 'parties'}"><tr>${partyCells
    .map(([k, v]) => `<td style="width:${cellWidth(pw, grid ? 6 : 0, border)}"><div class="lbl">${k.toUpperCase()}</div><div class="small">${v}</div></td>`)
    .join('')}</tr></table>`;

  // ── Items ─────────────────────────────────────────────────────────────────
  const cols: Col[] = [{ key: 'n', label: '#', width: 18, align: 'center' }, { key: 'item', label: 'Item', width: 0, align: 'left' }];
  if (anyHsn) cols.push({ key: 'hsn', label: gst ? 'HSN/SAC' : 'Code', width: 46, align: 'left' });
  cols.push({ key: 'qty', label: 'Qty', width: 44, align: 'right' });
  cols.push({ key: 'rate', label: 'Rate', width: 58, align: 'right' });
  if (anyDiscount) cols.push({ key: 'disc', label: 'Disc.', width: 44, align: 'right' });
  if (showTax) {
    cols.push({ key: 'taxable', label: 'Taxable', width: 62, align: 'right' });
    cols.push({ key: 'pct', label: `${taxName} %`, width: 36, align: 'right' });
    cols.push({ key: 'tax', label: taxName, width: 54, align: 'right' });
  }
  cols.push({ key: 'amount', label: 'Amount', width: 66, align: 'right' });
  const fixed = cols.reduce((sum, c) => sum + c.width, 0);
  (cols[1] as Col).width = W - fixed;

  const cell = (c: Col, html: string, cls = '') =>
    `<td class="${cls}${c.align !== 'left' ? ` ${c.align === 'right' ? 'r' : 'c'}` : ''}" style="width:${cellWidth(c.width, PAD, border)}">${html}</td>`;
  let rows = `<tr class="ih">${cols.map((c) => cell(c, esc(c.label))).join('')}</tr>`;
  inv.items.forEach((it, i) => {
    const l = t.lines[i];
    if (!l) return;
    const [first, ...more] = it.description.trim().split(/\r?\n/);
    const desc = `${esc(first || '—')}${more.length ? `<div class="sub">${more.map(esc).join('<br>')}</div>` : ''}`;
    const v: Record<string, string> = {
      n: String(i + 1),
      item: desc,
      hsn: esc(it.hsn.trim()),
      qty: `${formatNumber(it.qty, cur.locale)}${it.unit.trim() ? ` ${esc(it.unit.trim())}` : ''}`,
      rate: formatMinorRate(it.rate, cur.locale, t.digits),
      disc: l.discount ? (it.discountKind === 'pct' ? `${formatNumber(it.discount, cur.locale)}%` : money(l.discount)) : '',
      taxable: money(l.taxable),
      pct: rateText(l.rate),
      tax: money(l.tax),
      amount: money(l.total),
    };
    rows += `<tr class="${i % 2 === 1 ? 'odd' : 'ev'}">${cols.map((c) => cell(c, v[c.key] ?? '')).join('')}</tr>`;
  });
  const items = `<table class="items">${rows}</table>`;

  // ── Totals and payment ──────────────────────────────────────────────────────
  const sumRows: [string, string, string?][] = [];
  if (anyDiscount) {
    sumRows.push(['Subtotal', money(t.gross)]);
    sumRows.push(['Discount', `− ${money(t.discount)}`]);
  }
  if (showTax) {
    sumRows.push(['Taxable value', money(t.taxable)]);
    for (const g of t.byRate) {
      if (g.rate === 0) continue;
      if (gst && t.intra) {
        sumRows.push([`CGST @ ${rateText(g.rate / 2)}%`, money(g.cgst)]);
        sumRows.push([`${half2} @ ${rateText(g.rate / 2)}%`, money(g.sgst)]);
      } else {
        sumRows.push([`${gst ? 'IGST' : taxName} @ ${rateText(g.rate)}%`, money(g.igst)]);
      }
    }
  } else if (!anyDiscount) {
    sumRows.push(['Subtotal', money(t.taxable)]);
  }
  if (inv.roundOff && t.roundOff !== 0) sumRows.push(['Round off', `${t.roundOff > 0 ? '+' : '−'} ${money(Math.abs(t.roundOff))}`]);
  const sumW = 228;
  const sumInner = grid ? sumW - border : sumW;
  const sumLabelW = sumInner - 96;
  const totalLabel = `Total (${cur.code === 'INR' ? '₹' : esc(cur.symbol)})`;
  const sumHtml =
    `<table class="sum">${sumRows
      .map(([k, v]) => `<tr><td style="width:${cellWidth(sumLabelW, PAD)}">${esc(k)}</td><td class="r" style="width:${cellWidth(96, PAD)}">${v}</td></tr>`)
      .join('')}` +
    `<tr class="tot"><td style="width:${cellWidth(sumLabelW, PAD)}">${totalLabel}</td><td class="r" style="width:${cellWidth(96, PAD)}">${money(t.total)}</td></tr></table>`;

  const leftParts: string[] = [];
  leftParts.push(`<div class="lbl">AMOUNT IN WORDS</div><div class="words">${esc(amountInWords(t.total, cur))}</div>`);
  const bk = inv.bank;
  const bankLines: string[] = [];
  if (bk.accountName.trim()) bankLines.push(`Account name: <b>${esc(bk.accountName.trim())}</b>`);
  if (bk.accountNumber.trim()) bankLines.push(`Account no.: <b>${esc(bk.accountNumber.trim())}</b>`);
  if (bk.ifsc.trim()) bankLines.push(`${gst ? 'IFSC' : 'Bank code'}: <b>${esc(bk.ifsc.trim().toUpperCase())}</b>`);
  const bankBranch = [bk.bankName.trim(), bk.branch.trim()].filter(Boolean).map(esc).join(', ');
  if (bankBranch) bankLines.push(bankBranch);
  if (bk.other.trim()) bankLines.push(lines(bk.other));
  if (bk.upiId.trim()) bankLines.push(`UPI: <b>${esc(bk.upiId.trim())}</b>`);
  const leftW2 = W - sumW - 12;
  let payment = '';
  if (bankLines.length || a.qr) {
    const qrSize = 78;
    const text = `<div class="lbl">PAYMENT DETAILS</div><div class="small">${bankLines.join('<br>')}</div>`;
    payment = a.qr
      ? `<table class="plain"><tr><td style="width:${pt(leftW2 - qrSize - 10)}">${text}</td><td class="c" style="width:${pt(qrSize + 10)}"><img src="${a.qr}" style="width:${pt(qrSize)};height:${pt(qrSize)}"><div class="tiny">Scan to pay with UPI</div></td></tr></table>`
      : text;
  }
  if (payment) leftParts.push(`<div class="gap">${payment}</div>`);
  const totals = `<table class="${grid ? 'box' : 'plain'} below"><tr><td style="width:${cellWidth(leftW2 + (grid ? 12 : 0), grid ? 6 : 0, border)}">${leftParts.join('')}</td>${grid ? '' : `<td style="width:12pt"></td>`}<td style="width:${pt(sumInner)}" class="${grid ? 'nopad' : ''}">${sumHtml}</td></tr></table>`;

  // ── HSN summary ─────────────────────────────────────────────────────────────
  let hsn = '';
  if (gst && inv.hsnSummary && t.byHsn.length > 0 && t.tax > 0) {
    const hc: Col[] = t.intra
      ? [
          { key: 'k', label: 'HSN/SAC', width: 0, align: 'left' },
          { key: 'tv', label: 'Taxable value', width: 84, align: 'right' },
          { key: 'cr', label: 'CGST %', width: 46, align: 'right' },
          { key: 'ca', label: 'CGST', width: 70, align: 'right' },
          { key: 'sr', label: `${half2} %`, width: 46, align: 'right' },
          { key: 'sa', label: half2, width: 70, align: 'right' },
          { key: 'tt', label: 'Total tax', width: 76, align: 'right' },
        ]
      : [
          { key: 'k', label: 'HSN/SAC', width: 0, align: 'left' },
          { key: 'tv', label: 'Taxable value', width: 96, align: 'right' },
          { key: 'ir', label: 'IGST %', width: 56, align: 'right' },
          { key: 'ia', label: 'IGST', width: 96, align: 'right' },
          { key: 'tt', label: 'Total tax', width: 96, align: 'right' },
        ];
    (hc[0] as Col).width = W - hc.reduce((x, c) => x + c.width, 0);
    let hr = `<tr class="ih">${hc.map((c) => cell(c, esc(c.label))).join('')}</tr>`;
    for (const g of t.byHsn) {
      const v: Record<string, string> = {
        k: esc(g.key.split('|')[0] as string),
        tv: money(g.taxable),
        cr: rateText(g.rate / 2),
        ca: money(g.cgst),
        sr: rateText(g.rate / 2),
        sa: money(g.sgst),
        ir: rateText(g.rate),
        ia: money(g.igst),
        tt: money(g.tax),
      };
      hr += `<tr class="ev">${hc.map((c) => cell(c, v[c.key] ?? '')).join('')}</tr>`;
    }
    const tv: Record<string, string> = { k: '<b>Total</b>', tv: `<b>${money(t.taxable)}</b>`, ca: `<b>${money(t.cgst)}</b>`, sa: `<b>${money(t.sgst)}</b>`, ia: `<b>${money(t.igst)}</b>`, tt: `<b>${money(t.tax)}</b>` };
    hr += `<tr class="ft">${hc.map((c) => cell(c, tv[c.key] ?? '')).join('')}</tr>`;
    hsn = `<div class="lbl sect">TAX SUMMARY</div><table class="items hsn">${hr}</table>`;
  }

  // ── Notes, terms, signature ───────────────────────────────────────────────
  const noteParts: string[] = [];
  if (inv.notes.trim()) noteParts.push(`<div class="lbl">NOTES</div><div class="small">${lines(inv.notes)}</div>`);
  if (inv.terms.trim()) noteParts.push(`<div class="lbl${noteParts.length ? ' gap' : ''}">TERMS &amp; CONDITIONS</div><div class="small">${lines(inv.terms)}</div>`);
  const sig = a.signature ? fitBox(a.signature.width, a.signature.height, 150, 48) : null;
  const signW = 190;
  const signHtml =
    `<div class="small">For <b>${esc(s.name.trim() || 'Your business name')}</b></div>` +
    (a.signature && sig ? `<div class="sig"><img src="${a.signature.src}" style="width:${pt(sig.w)};height:${pt(sig.h)}"></div>` : '<div class="sigspace"></div>') +
    `<div class="signl">${esc(inv.signLabel.trim() || 'Authorised Signatory')}</div>`;
  const notesW = W - signW;
  const footer = `<table class="${grid ? 'box' : 'plain'} foot"><tr><td style="width:${cellWidth(notesW, grid ? 6 : 0, border)}">${noteParts.join('')}</td><td class="r" style="width:${cellWidth(signW, grid ? 6 : 0, border)}">${signHtml}</td></tr></table>`;
  const generated = gst && !a.signature ? `<div class="tiny c gen">This is a computer-generated invoice.</div>` : '';

  const body = `${header}${parties}${items}${totals}${hsn}${footer}${generated}`;
  return { body: breakLigatures(body), css: invoiceCss(tpl, accent), width: paper.width, height: paper.height };
}

function formatMinorRate(rate: number, locale: string, digits: number): string {
  // Rates keep up to 4 decimals when typed that way (0.125), at least the currency's digits.
  const typed = (String(rate).split('.')[1] ?? '').length;
  const d = Math.min(4, Math.max(digits, typed));
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: d }).format(rate);
}

function invoiceCss(tpl: TemplateId, accent: string): string {
  const light = tint(accent, 0.9);
  const font = tpl === 'minimal' ? 'Calibri' : 'sans-serif';
  const base = `
body{font-family:${font};font-size:8.6pt;line-height:1.35;color:#1f2329;margin:0}
table{border-collapse:collapse;margin:0}
td{vertical-align:top;padding:0}
b{font-weight:bold}
.r{text-align:right}
.c{text-align:center}
.small{font-size:8.4pt;color:#3d434b;line-height:1.4}
.tiny{font-size:6.8pt;color:#6b717a}
.lbl{font-size:7pt;font-weight:bold;color:#6b717a;margin:0 0 2pt}
.sect{margin-top:12pt}
.gap{margin-top:9pt}
.sname{font-size:13pt;font-weight:bold;color:#111418;margin:0 0 3pt}
.pname{font-size:9.6pt;font-weight:bold;color:#111418;margin:0 0 1pt}
.meta{font-size:8.4pt;line-height:1.55}
.mk{color:#6b717a}
.logo{margin:0 0 6pt}
.words{font-size:8.6pt;font-weight:bold;color:#1f2329}
.sub{font-size:7.6pt;color:#6b717a}
.sig{margin:6pt 0 2pt}
.sigspace{height:40pt}
.signl{font-size:7.6pt;color:#3d434b;border-top:0.6pt solid #9aa0a8;padding-top:2pt;margin-left:60pt}
.gen{margin-top:14pt}
table.items td,table.sum td{padding:${PAD - 0.5}pt ${PAD}pt}
table.items tr.ih td{font-weight:bold;font-size:7.6pt}
table.sum tr.tot td{font-weight:bold;font-size:10.5pt}
table.foot{margin-top:16pt}
table.below{margin-top:10pt}
`;
  if (tpl === 'modern') {
    return `${base}
.bar{height:5pt;background-color:${accent};margin:0 0 16pt}
.ttl{font-size:20pt;font-weight:bold;color:${accent};margin:0 0 6pt}
table.head{margin:0 0 16pt}
table.parties{margin:0 0 14pt}
table.parties td{padding:8pt 0 0;border-top:0.6pt solid #d9dde3}
table.items tr.ih td{background-color:${accent};color:#ffffff}
table.items tr.odd td{background-color:${light}}
table.items tr.ev td,table.items tr.odd td{border-bottom:0.5pt solid #e3e6ea}
table.items tr.ft td{background-color:${light};border-top:0.8pt solid ${accent}}
table.sum td{border-bottom:0.5pt solid #e3e6ea}
table.sum tr.tot td{background-color:${accent};color:#ffffff;border-bottom:none}
.signl{border-top-color:${accent}}
`;
  }
  if (tpl === 'classic') {
    return `${base}
table.box td{border:0.75pt solid #5b6068;padding:5pt 6pt}
table.box td.nopad{padding:0}
table.box td.ttl{font-size:13pt;font-weight:bold;text-align:center;background-color:${light};color:#111418;padding:5pt 4pt}
table.box,table.items{margin:0}
table.items td{border:0.75pt solid #5b6068}
table.items tr.ih td{background-color:${light};color:#111418}
table.items tr.ft td{background-color:${light}}
table.sum td{border:none;border-bottom:0.75pt solid #c3c7cd}
table.sum tr.tot td{background-color:${light};border-bottom:none;color:#111418}
.sname{color:${accent}}
table.foot{margin-top:0}
table.hsn{margin-top:0}
.sect{margin-top:8pt}
.signl{margin-left:30pt}
`;
  }
  return `${base}
.ttl{font-size:22pt;color:${accent};margin:0 0 8pt}
table.head{margin:0 0 20pt}
table.parties{margin:0 0 18pt}
table.items tr.ih td{border-bottom:1pt solid ${accent};color:${accent}}
table.items tr.ev td,table.items tr.odd td{border-bottom:0.4pt solid #e6e8eb}
table.items tr.ft td{border-top:0.8pt solid #9aa0a8}
table.sum tr.tot td{border-top:1pt solid ${accent};color:${accent}}
.sname{font-size:12pt}
`;
}
