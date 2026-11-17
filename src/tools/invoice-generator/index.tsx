'use client';

import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AreaField,
  blobToDataUrl,
  Field,
  fileStem,
  JsonButtons,
  SelectField,
  TextField,
} from '@/components/business/form-bits';
import { HtmlPreview } from '@/components/business/html-preview';
import { imageFileToDataUrl, previewDocument, type SizedImage, sizeImage } from '@/components/business/html';
import { CURRENCIES, currencyInfo, formatMinor } from '@/components/business/money';
import { isUpiId, qrPngDataUrl, upiLink } from '@/components/business/qr';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { ImagePicker, NumberInput, SwitchRow } from '@/components/pdf-stage';
import { EngineNote, type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type ResultFile, RunBar } from '@/components/workbench';
import { isAbortError } from '@/engines';
import { TYPESET_DOWNLOAD_BYTES, typesetEngine } from '@/engines/typeset';
import { newId } from '@/lib/files';
import { cn } from '@/lib/utils';
import { SignatureMaker } from '@/tools/sign-pdf/signature-maker';
import type { ToolProps } from '@/tools/types';
import { computeTotals, placeOfSupply, sellerState } from './calc';
import { checkGstin, checkHsn, GST_STATES, gstState, normalizeGstin } from './gst';
import {
  ACCENTS,
  clearRemembered,
  datesFromToday,
  defaultInvoice,
  type Invoice,
  type LineItem,
  loadRemembered,
  type Mode,
  newItem,
  type Party,
  parseInvoice,
  type PaperId,
  saveRemembered,
  serializeInvoice,
} from './model';
import { MARGIN, renderInvoice, TEMPLATES } from './render';

const REMEMBER_FLAG = 'metamorpher:invoice-remember';
const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40];
const STATE_OPTIONS = [{ value: '', label: 'Choose a state' }, ...GST_STATES.filter((s) => s.code !== '96').map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))];

function gstinError(v: string): string | null {
  if (!v.trim()) return null;
  const r = checkGstin(v);
  return r.ok ? null : r.error;
}

function PartyFields({
  party,
  onChange,
  gst,
  role,
}: {
  party: Party;
  onChange: (p: Party) => void;
  gst: boolean;
  role: 'seller' | 'buyer';
}) {
  const set = (patch: Partial<Party>) => onChange({ ...party, ...patch });
  const fromGstin = /^\d{2}/.test(party.gstin) && checkGstin(party.gstin).ok;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        className="sm:col-span-2"
        label={role === 'seller' ? 'Business name' : 'Customer name'}
        value={party.name}
        onChange={(name) => set({ name })}
      />
      <AreaField className="sm:col-span-2" label="Address" value={party.address} onChange={(address) => set({ address })} rows={2} />
      {gst ? (
        <>
          <TextField
            label="GSTIN"
            value={party.gstin}
            placeholder={role === 'buyer' ? 'Leave empty for unregistered buyers' : '22AAAAA0000A1Z5'}
            maxLength={20}
            error={gstinError(party.gstin)}
            hint={fromGstin ? `State: ${gstState(party.gstin.slice(0, 2))?.name ?? ''} (from GSTIN)` : undefined}
            onChange={(v) => {
              const gstin = normalizeGstin(v);
              const ok = checkGstin(gstin);
              set({ gstin, ...(ok.ok ? { state: ok.state } : {}) });
            }}
          />
          <SelectField label="State" value={party.state} options={STATE_OPTIONS} onChange={(state) => set({ state })} />
        </>
      ) : (
        <TextField
          className="sm:col-span-2"
          label="Tax / VAT number"
          value={party.taxId}
          placeholder="VAT GB123456789"
          onChange={(taxId) => set({ taxId })}
        />
      )}
      <TextField label="Phone" value={party.phone} inputMode="tel" onChange={(phone) => set({ phone })} />
      <TextField label="Email" value={party.email} inputMode="email" onChange={(email) => set({ email })} />
    </div>
  );
}

function ItemRow({
  item,
  index,
  count,
  gst,
  money,
  amount,
  taxLabel,
  onChange,
  onRemove,
  onMove,
}: {
  item: LineItem;
  index: number;
  count: number;
  gst: boolean;
  money: string;
  amount: string;
  taxLabel: string;
  onChange: (i: LineItem) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const set = (patch: Partial<LineItem>) => onChange({ ...item, ...patch });
  const hsnError = gst ? checkHsn(item.hsn) : null;
  // useId, not the item's random id: the first render happens on the server too.
  const id = useId();
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3" data-item-row>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 w-5 shrink-0 font-mono text-[0.7rem] text-muted-foreground">{index + 1}</span>
        <Textarea
          aria-label={`Item ${index + 1} description`}
          value={item.description}
          placeholder="Item or service (second line: details)"
          rows={1}
          maxLength={600}
          className="min-h-0 flex-1"
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <div className="flex shrink-0 gap-0.5">
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove item" disabled={count === 1} onClick={onRemove}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 pl-7 sm:grid-cols-6">
        <Field label={gst ? 'HSN/SAC' : 'Code'} htmlFor={`${id}-hsn`} error={hsnError}>
          <input
            id={`${id}-hsn`}
            value={item.hsn}
            inputMode={gst ? 'numeric' : undefined}
            maxLength={12}
            aria-invalid={hsnError ? true : undefined}
            onChange={(e) => set({ hsn: e.currentTarget.value.replace(/\s/g, '') })}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive md:text-xs/relaxed dark:bg-input/30"
          />
        </Field>
        <Field label="Qty" htmlFor={`${id}-qty`}>
          <NumberInput id={`${id}-qty`} value={item.qty} min={0} max={1e9} step={1} onChange={(qty) => set({ qty })} />
        </Field>
        <Field label="Unit" htmlFor={`${id}-unit`}>
          <input
            id={`${id}-unit`}
            value={item.unit}
            placeholder="pcs"
            maxLength={12}
            onChange={(e) => set({ unit: e.currentTarget.value })}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed dark:bg-input/30"
          />
        </Field>
        <Field label={`Rate (${money})`} htmlFor={`${id}-rate`}>
          <NumberInput id={`${id}-rate`} value={item.rate} min={0} max={1e12} step={0.01} onChange={(rate) => set({ rate })} />
        </Field>
        <Field label="Discount" htmlFor={`${id}-disc`}>
          <div className="flex items-center gap-1">
            <NumberInput
              id={`${id}-disc`}
              className="min-w-0 flex-1"
              value={item.discount}
              min={0}
              max={item.discountKind === 'pct' ? 100 : 1e12}
              step={item.discountKind === 'pct' ? 1 : 0.01}
              onChange={(discount) => set({ discount })}
            />
            <button
              type="button"
              className="h-7 shrink-0 rounded-md border px-1.5 text-[0.7rem] font-medium text-muted-foreground hover:text-foreground"
              title="Switch between percent and amount"
              aria-label={`Discount as ${item.discountKind === 'pct' ? 'percent' : 'amount'}; switch`}
              onClick={() => set({ discountKind: item.discountKind === 'pct' ? 'amt' : 'pct', discount: 0 })}
            >
              {item.discountKind === 'pct' ? '%' : money}
            </button>
          </div>
        </Field>
        {gst ? (
          <SelectField
            label="GST %"
            value={String(item.taxRate)}
            options={[...new Set([...GST_RATES, item.taxRate])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }))}
            onChange={(v) => set({ taxRate: Number(v) })}
          />
        ) : (
          <Field label={`${taxLabel} %`} htmlFor={`${id}-tax`}>
            <NumberInput id={`${id}-tax`} value={item.taxRate} min={0} max={100} step={0.5} onChange={(taxRate) => set({ taxRate })} />
          </Field>
        )}
      </div>
      <p className="pl-7 text-right font-mono text-[0.7rem] text-muted-foreground tabular-nums">
        Amount <span className="font-semibold text-foreground">{amount}</span>
      </p>
    </li>
  );
}

function useSized(src: string | null): SizedImage | null {
  const [img, setImg] = useState<SizedImage | null>(null);
  useEffect(() => {
    let live = true;
    if (!src) return;
    sizeImage(src)
      .then((s) => live && setImg(s))
      .catch(() => live && setImg(null));
    return () => {
      live = false;
    };
  }, [src]);
  return src && img?.src === src ? img : null;
}

export default function InvoiceGenerator(_props: ToolProps) {
  const [inv, setInv] = useState<Invoice>(() => defaultInvoice('gst'));
  const [remember, setRemember] = useState(false);
  const [signing, setSigning] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string>();
  const [result, setResult] = useState<ResultFile | null>(null);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const abort = useRef<AbortController | null>(null);

  // Dates come from this device's clock (the server may be in another time zone).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
    setInv((cur) => (cur.date ? cur : { ...cur, ...datesFromToday() }));
  }, []);

  // Remembered seller details (opt-in), read once on this device.
  useEffect(() => {
    let flag = false;
    try {
      flag = localStorage.getItem(REMEMBER_FLAG) === '1';
    } catch {
      flag = false;
    }
    if (!flag) return;
    const r = loadRemembered();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
    setRemember(true);
    if (r) setInv((cur) => ({ ...cur, seller: r.seller, bank: { ...r.bank, upiQr: cur.bank.upiQr }, terms: r.terms || cur.terms, signLabel: r.signLabel }));
  }, []);

  useEffect(() => {
    if (!remember) return;
    const t = setTimeout(() => saveRemembered(inv), 400);
    return () => clearTimeout(t);
  }, [remember, inv]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  const set = (patch: Partial<Invoice>) => setInv((cur) => ({ ...cur, ...patch }));
  const gst = inv.mode === 'gst';
  const totals = useMemo(() => computeTotals(inv), [inv]);
  const cur = currencyInfo(gst ? 'INR' : inv.currency);
  const fmt = (minor: number) => `${cur.symbol} ${formatMinor(minor, { locale: cur.locale, digits: totals.digits })}`;

  const logo = useSized(inv.logo);
  const signature = useSized(inv.signature);
  const upiOk = isUpiId(inv.bank.upiId);
  const showUpi = gst || inv.currency === 'INR';
  const qr = useMemo(() => {
    if (!showUpi || !inv.bank.upiQr || !upiOk || totals.total <= 0 || typeof document === 'undefined') return null;
    try {
      return qrPngDataUrl(
        upiLink({ vpa: inv.bank.upiId, name: inv.bank.accountName || inv.seller.name, amount: totals.total / 100, note: `Invoice ${inv.number}`.trim() }),
        { ecc: 'M', px: 6, border: 2 },
      );
    } catch {
      return null;
    }
  }, [showUpi, inv.bank.upiQr, inv.bank.upiId, inv.bank.accountName, inv.seller.name, inv.number, upiOk, totals.total]);

  const doc = useMemo(() => renderInvoice(inv, totals, { logo, signature, qr }), [inv, totals, logo, signature, qr]);
  const previewHtml = useMemo(() => previewDocument(doc.body, doc.css, { width: doc.width, margin: MARGIN }), [doc]);

  const warnings: string[] = [];
  if (gst) {
    if (inv.seller.gstin && !checkGstin(inv.seller.gstin).ok) warnings.push('Your GSTIN does not look valid.');
    if (inv.buyer.gstin && !checkGstin(inv.buyer.gstin).ok) warnings.push("The customer's GSTIN does not look valid.");
    if (!sellerState(inv)) warnings.push('Add your GSTIN or state, so CGST/SGST or IGST can be chosen.');
    if (!placeOfSupply(inv)) warnings.push('Add the place of supply (or the customer’s state).');
  }
  if (inv.bank.upiQr && showUpi && inv.bank.upiId && !upiOk) warnings.push('The UPI ID should look like name@bank.');

  function changeMode(mode: Mode) {
    if (mode === inv.mode) return;
    setInv((c) => {
      const d = defaultInvoice(mode);
      return {
        ...c,
        mode,
        title: c.title === defaultInvoice(c.mode).title ? d.title : c.title,
        currency: d.currency,
        taxLabel: d.taxLabel,
        roundOff: d.roundOff,
      };
    });
  }

  function updateItem(index: number, item: LineItem) {
    setInv((c) => ({ ...c, items: c.items.map((x, i) => (i === index ? item : x)) }));
  }

  function moveItem(index: number, delta: -1 | 1) {
    setInv((c) => {
      const items = [...c.items];
      const j = index + delta;
      if (j < 0 || j >= items.length) return c;
      [items[index], items[j]] = [items[j] as LineItem, items[index] as LineItem];
      return { ...c, items };
    });
  }

  async function create() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProgress(0);
    setResult(null);
    setNotes([]);
    try {
      const out = await typesetEngine.render(
        {
          blocks: [{ kind: 'html', html: doc.body }],
          css: doc.css,
          page: { width: doc.width, height: doc.height, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
          fontSize: 8.6,
          outline: false,
          pageNumbers: false,
          title: `${inv.title.trim() || 'Invoice'} ${inv.number}`.trim(),
          author: inv.seller.name.trim() || undefined,
          lang: gst ? 'en-IN' : 'en',
        },
        {
          signal: controller.signal,
          onProgress: (d, _t, n) => {
            setProgress(d);
            setNote(n);
          },
        },
      );
      const name = `${fileStem(`${inv.title || 'Invoice'}-${inv.number}`, 'invoice')}.pdf`;
      setResult({ id: newId('r'), name, blob: out.blob, url: URL.createObjectURL(out.blob) });
      const n: ResultNote[] = [
        { kind: 'ok', text: `${out.pages} ${out.pages === 1 ? 'page' : 'pages'}, text is real and selectable. Total ${fmt(totals.total)}.` },
      ];
      if (out.missing.length) n.push({ kind: 'warn', text: `Some characters could not be shown: ${out.missing.join(' ')}` });
      if (qr) n.push({ kind: 'info', text: 'The UPI QR code asks for the invoice total. Test it with a small payment first.' });
      setNotes(n);
    } catch (err) {
      if (!isAbortError(err)) toast.error(err instanceof Error ? err.message : 'Could not create the PDF.');
      else toast.info('Cancelled.');
    } finally {
      abort.current = null;
      setRunning(false);
      setNote(undefined);
    }
  }

  const sellerStateCode = sellerState(inv);
  const pos = placeOfSupply(inv);
  const posOptions = [
    { value: '', label: pos && !inv.placeOfSupply ? `Auto: ${gstState(pos)?.name ?? pos} (${pos})` : 'Auto (customer’s state)' },
    ...GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="Invoice"
            description="Everything stays on this device."
            action={
              <Segmented<Mode>
                label="Invoice type"
                value={inv.mode}
                options={[
                  { value: 'gst', label: 'GST (India)' },
                  { value: 'generic', label: 'Other' },
                ]}
                onChange={changeMode}
              />
            }
            contentClassName="grid gap-3 sm:grid-cols-3"
          >
            <TextField label="Title" value={inv.title} onChange={(title) => set({ title })} />
            <TextField label="Invoice number" value={inv.number} onChange={(number) => set({ number })} />
            <TextField label="Reference / PO" value={inv.reference} onChange={(reference) => set({ reference })} />
            <TextField label="Invoice date" type="date" value={inv.date} onChange={(date) => set({ date })} />
            <TextField label="Due date" type="date" value={inv.dueDate} onChange={(dueDate) => set({ dueDate })} />
            {gst ? (
              <SelectField
                label="Place of supply"
                value={inv.placeOfSupply}
                options={posOptions}
                onChange={(placeOfSupply) => set({ placeOfSupply })}
              />
            ) : (
              <SelectField
                label="Currency"
                value={inv.currency}
                options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))}
                onChange={(currency) => set({ currency })}
              />
            )}
            {gst ? (
              <div className="flex flex-col justify-end gap-1 sm:col-span-3">
                <p className="text-[0.7rem]/relaxed text-muted-foreground" data-tax-split>
                  {sellerStateCode && pos
                    ? totals.intra
                      ? `Same state (${gstState(sellerStateCode)?.name ?? sellerStateCode}): CGST + ${totals.utgst ? 'UTGST' : 'SGST'}.`
                      : pos === '96'
                        ? 'Export: IGST.'
                        : `Different states (${gstState(sellerStateCode)?.name ?? sellerStateCode} → ${gstState(pos)?.name ?? pos}): IGST.`
                    : 'Add your GSTIN or state and the customer’s, and the tax split is chosen for you.'}
                </p>
                <SwitchRow id="inv-rcm" label="Tax payable on reverse charge" checked={inv.reverseCharge} onChange={(reverseCharge) => set({ reverseCharge })} />
              </div>
            ) : (
              <TextField label="Tax name" value={inv.taxLabel} placeholder="VAT, Sales tax…" maxLength={20} onChange={(taxLabel) => set({ taxLabel })} />
            )}
          </SectionCard>

          <SectionCard
            title="From"
            description="Your business."
            contentClassName="flex flex-col gap-3"
            action={
              <div className="flex items-center gap-2">
                {remember ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearRemembered();
                      try {
                        localStorage.removeItem(REMEMBER_FLAG);
                      } catch {
                        // ignore
                      }
                      setRemember(false);
                      toast.success('Forgot the saved seller details on this device.');
                    }}
                  >
                    Forget
                  </Button>
                ) : null}
              </div>
            }
          >
            <PartyFields party={inv.seller} gst={gst} role="seller" onChange={(seller) => set({ seller })} />
            <Field label="Logo">
              <div className="flex items-center gap-2">
                <ImagePicker
                  id="inv-logo"
                  value={null}
                  label={inv.logo ? 'Replace logo' : 'Add logo'}
                  onChange={async (file) => {
                    if (!file) return;
                    try {
                      set({ logo: await imageFileToDataUrl(file, 600) });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'This image could not be read.');
                    }
                  }}
                />
                {inv.logo ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inv.logo} alt="Logo" className="h-10 max-w-28 rounded border bg-white object-contain p-0.5" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => set({ logo: null })}>
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </Field>
            <SwitchRow
              id="inv-remember"
              label="Remember my details on this device"
              checked={remember}
              onChange={(on) => {
                setRemember(on);
                try {
                  if (on) localStorage.setItem(REMEMBER_FLAG, '1');
                  else localStorage.removeItem(REMEMBER_FLAG);
                } catch {
                  // ignore
                }
                if (on) saveRemembered(inv);
                else clearRemembered();
              }}
              hint="Saves your business, bank and terms text in this browser's storage (not the logo or signature). Turn off or press Forget to remove it."
            />
          </SectionCard>

          <SectionCard title="Bill to" description="Your customer." contentClassName="flex flex-col gap-3">
            <PartyFields party={inv.buyer} gst={gst} role="buyer" onChange={(buyer) => set({ buyer })} />
            <AreaField label="Ship to (if different)" value={inv.shipTo} onChange={(shipTo) => set({ shipTo })} rows={2} />
          </SectionCard>

          <SectionCard
            title="Items"
            description={`${inv.items.length} ${inv.items.length === 1 ? 'line' : 'lines'} · taxable ${fmt(totals.taxable)} · ${gst ? 'GST' : inv.taxLabel || 'tax'} ${fmt(totals.tax)}`}
            contentClassName="flex flex-col gap-3"
          >
            <ul className="flex flex-col gap-2">
              {inv.items.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={i}
                  count={inv.items.length}
                  gst={gst}
                  money={cur.symbol}
                  taxLabel={inv.taxLabel || 'Tax'}
                  amount={fmt(totals.lines[i]?.total ?? 0)}
                  onChange={(next) => updateItem(i, next)}
                  onRemove={() => setInv((c) => ({ ...c, items: c.items.filter((_, j) => j !== i) }))}
                  onMove={(d) => moveItem(i, d)}
                />
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={inv.items.length >= 500}
              onClick={() => setInv((c) => ({ ...c, items: [...c.items, newItem({ taxRate: c.items.at(-1)?.taxRate ?? (gst ? 18 : 0) })] }))}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Add item
            </Button>
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              <SwitchRow id="inv-round" label="Round the total to a whole amount" checked={inv.roundOff} onChange={(roundOff) => set({ roundOff })} />
              {gst ? (
                <SwitchRow id="inv-hsn" label="Tax summary by HSN/SAC" checked={inv.hsnSummary} onChange={(hsnSummary) => set({ hsnSummary })} />
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Payment" description="Shown under the totals." contentClassName="grid gap-3 sm:grid-cols-2">
            <TextField label="Account name" value={inv.bank.accountName} onChange={(accountName) => set({ bank: { ...inv.bank, accountName } })} />
            <TextField label="Account number" value={inv.bank.accountNumber} inputMode="numeric" onChange={(accountNumber) => set({ bank: { ...inv.bank, accountNumber } })} />
            <TextField label={gst ? 'IFSC' : 'Sort code / routing / SWIFT'} value={inv.bank.ifsc} onChange={(ifsc) => set({ bank: { ...inv.bank, ifsc } })} />
            <TextField label="Bank and branch" value={[inv.bank.bankName, inv.bank.branch].filter(Boolean).join(', ')} onChange={(v) => {
              const [bankName = '', ...rest] = v.split(',');
              set({ bank: { ...inv.bank, bankName: bankName.trimStart(), branch: rest.join(',').trim() } });
            }} />
            {gst ? null : (
              <AreaField className="sm:col-span-2" label="Other payment details (IBAN, PayPal…)" value={inv.bank.other} onChange={(other) => set({ bank: { ...inv.bank, other } })} />
            )}
            {showUpi ? (
              <>
                <TextField
                  label="UPI ID"
                  value={inv.bank.upiId}
                  placeholder="yourname@bank"
                  error={inv.bank.upiId && !upiOk ? 'A UPI ID looks like name@bank.' : null}
                  onChange={(upiId) => set({ bank: { ...inv.bank, upiId: upiId.trim() } })}
                />
                <div className="flex items-end pb-1">
                  <SwitchRow
                    id="inv-upi-qr"
                    label="UPI QR code for the total"
                    checked={inv.bank.upiQr}
                    onChange={(upiQr) => set({ bank: { ...inv.bank, upiQr } })}
                  />
                </div>
              </>
            ) : null}
          </SectionCard>

          <SectionCard title="Notes and signature" contentClassName="grid gap-3 sm:grid-cols-2">
            <AreaField label="Notes" value={inv.notes} onChange={(notes) => set({ notes })} rows={2} />
            <AreaField label="Terms and conditions" value={inv.terms} onChange={(terms) => set({ terms })} rows={2} />
            <TextField label="Signature caption" value={inv.signLabel} onChange={(signLabel) => set({ signLabel })} />
            <Field label="Signature">
              <div className="flex flex-wrap items-center gap-2">
                {inv.signature ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inv.signature} alt="Signature" className="h-10 max-w-36 rounded border bg-white object-contain p-0.5" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => set({ signature: null })}>
                      Remove
                    </Button>
                  </>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => setSigning((s) => !s)} aria-expanded={signing}>
                  {signing ? 'Close' : inv.signature ? 'Change signature' : 'Add signature'}
                </Button>
              </div>
            </Field>
            {signing ? (
              <div className="rounded-lg border p-3 sm:col-span-2">
                <SignatureMaker
                  onCreate={async (ink) => {
                    set({ signature: await blobToDataUrl(ink.blob) });
                    setSigning(false);
                  }}
                />
              </div>
            ) : null}
          </SectionCard>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
          <SectionCard
            title="Preview"
            description={`Total ${fmt(totals.total)}`}
            contentClassName="flex flex-col gap-3"
            action={
              <Segmented<PaperId>
                label="Paper"
                value={inv.paper}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                ]}
                onChange={(paper) => set({ paper })}
              />
            }
          >
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Template">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={inv.template === t.id}
                  title={t.hint}
                  onClick={() => set({ template: t.id })}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                    inv.template === t.id ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={inv.accent === c}
                  aria-label={`Accent ${c}`}
                  onClick={() => set({ accent: c })}
                  className={cn('size-6 rounded-full border-2', inv.accent === c ? 'border-foreground' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="Custom accent colour"
                value={inv.accent}
                onChange={(e) => set({ accent: e.currentTarget.value })}
                className="h-6 w-8 cursor-pointer rounded border bg-transparent p-0.5"
              />
            </div>
            <HtmlPreview html={previewHtml} pageWidth={doc.width} pageHeight={doc.height} maxHeight={720} title="Invoice preview" />
            {warnings.length ? (
              <ul className="flex flex-col gap-1" data-warnings>
                {warnings.map((w) => (
                  <li key={w} className="text-[0.7rem]/relaxed text-warning">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
            <JsonButtons
              fileName={() => `${fileStem(inv.number, 'invoice')}.json`}
              serialize={() => serializeInvoice(inv)}
              onLoad={(text) => {
                setInv(parseInvoice(text));
                setResult(null);
              }}
            />
            <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
          </SectionCard>
          <RunBar
            label="Create PDF"
            running={running}
            progress={progress}
            note={note}
            disabledReason={inv.items.some((i) => i.description.trim() || i.rate) ? null : 'Add at least one item.'}
            onRun={create}
            onCancel={() => abort.current?.abort()}
          />
          {result ? <ResultRows results={[result]} notesFor={() => notes} /> : null}
        </div>
      </div>
    </div>
  );
}
