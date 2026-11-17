'use client';

import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { contentBottom, cropTop, pageToPng } from '@/components/business/fit-page';
import { AreaField, Field, fileStem, JsonButtons, SelectField, TextField } from '@/components/business/form-bits';
import { HtmlPreview } from '@/components/business/html-preview';
import { previewDocument } from '@/components/business/html';
import { CURRENCIES, currencyInfo, formatMinor } from '@/components/business/money';
import { isUpiId, qrPngDataUrl, upiLink } from '@/components/business/qr';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { NumberInput, SwitchRow } from '@/components/pdf-stage';
import { EngineNote, type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ResultFile, RunBar } from '@/components/workbench';
import { isAbortError } from '@/engines';
import { TYPESET_DOWNLOAD_BYTES, typesetEngine } from '@/engines/typeset';
import { newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import {
  computeReceipt,
  defaultReceipt,
  newReceiptItem,
  nowLocal,
  type PaperWidth,
  parseReceipt,
  type QrKind,
  type Receipt,
  type ReceiptItem,
  serializeReceipt,
  type TaxMode,
} from './model';
import { BOTTOM, PAPERS, renderReceipt, TOP } from './render';

const TALL = 14000; // points: one page as long as PDF allows, cut to the content afterwards
const DRAFT_KEY = 'metamorpher:pos-receipt-shop';
const PAYMENTS = ['Cash', 'Card', 'UPI', 'Wallet', 'Credit', 'Bank transfer', 'Split'];

type Dpi = 203 | 300;

function ItemRow({
  item,
  index,
  taxed,
  onChange,
  onRemove,
  canRemove,
  money,
}: {
  item: ReceiptItem;
  index: number;
  taxed: boolean;
  onChange: (i: ReceiptItem) => void;
  onRemove: () => void;
  canRemove: boolean;
  money: string;
}) {
  const set = (p: Partial<ReceiptItem>) => onChange({ ...item, ...p });
  const id = useId();
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border bg-background/60 p-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_4.5rem_auto]" data-item-row>
      <Input aria-label={`Item ${index + 1} name`} value={item.name} placeholder="Item name" maxLength={80} onChange={(e) => set({ name: e.currentTarget.value })} className="sm:col-span-1" />
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove item" disabled={!canRemove} onClick={onRemove} className="sm:order-last">
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>
      <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
        <Field label="Qty" htmlFor={`${id}-q`}>
          <NumberInput id={`${id}-q`} value={item.qty} min={0} max={1e6} onChange={(qty) => set({ qty })} />
        </Field>
        <Field label={`Rate (${money})`} htmlFor={`${id}-r`}>
          <NumberInput id={`${id}-r`} value={item.rate} min={0} max={1e10} step={0.01} onChange={(rate) => set({ rate })} />
        </Field>
        {taxed ? (
          <Field label="Tax %" htmlFor={`${id}-t`}>
            <NumberInput id={`${id}-t`} value={item.taxRate} min={0} max={100} step={0.5} onChange={(taxRate) => set({ taxRate })} />
          </Field>
        ) : (
          <span />
        )}
      </div>
    </li>
  );
}

export default function PosReceipt(_props: ToolProps) {
  const [r, setR] = useState<Receipt>(defaultReceipt);
  const [dpi, setDpi] = useState<Dpi>(203);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string>();
  const [results, setResults] = useState<ResultFile[]>([]);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const abort = useRef<AbortController | null>(null);
  const [rememberShop, setRememberShop] = useState(false);

  // The bill time comes from this device's clock, after the first (server) render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
    setR((c) => (c.date ? c : { ...c, date: nowLocal() }));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Partial<Receipt>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
      setRememberShop(true);
      setR((c) => ({
        ...c,
        shopName: typeof o.shopName === 'string' ? o.shopName : c.shopName,
        shopLines: typeof o.shopLines === 'string' ? o.shopLines : c.shopLines,
        gstin: typeof o.gstin === 'string' ? o.gstin : c.gstin,
        footer: typeof o.footer === 'string' ? o.footer : c.footer,
      }));
    } catch {
      // Nothing remembered.
    }
  }, []);

  useEffect(() => {
    if (!rememberShop) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ shopName: r.shopName, shopLines: r.shopLines, gstin: r.gstin, footer: r.footer }));
      } catch {
        // Storage blocked.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [rememberShop, r.shopName, r.shopLines, r.gstin, r.footer]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const urls = results.map((x) => x.url);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [results]);

  const set = (p: Partial<Receipt>) => setR((c) => ({ ...c, ...p }));
  const totals = useMemo(() => computeReceipt(r), [r]);
  const cur = currencyInfo(r.currency);
  const fmt = (m: number) => `${cur.symbol} ${formatMinor(m, { locale: cur.locale, digits: totals.digits })}`;
  const upiOk = isUpiId(r.qrValue);
  const qrError =
    r.qrKind === 'upi' && r.qrValue && !upiOk ? 'A UPI ID looks like name@bank.' : r.qrKind === 'text' && r.qrValue.length > 1200 ? 'Keep QR text under 1,200 characters.' : null;

  const qr = useMemo(() => {
    if (typeof document === 'undefined' || r.qrKind === 'none' || !r.qrValue.trim() || qrError) return null;
    try {
      const text =
        r.qrKind === 'upi'
          ? upiLink({ vpa: r.qrValue, name: r.shopName, amount: r.currency === 'INR' ? totals.total / 100 : undefined, note: r.billNo ? `Bill ${r.billNo}` : undefined })
          : r.qrValue.trim();
      return qrPngDataUrl(text, { ecc: 'M', px: 6, border: 2 });
    } catch {
      return null;
    }
  }, [r.qrKind, r.qrValue, r.shopName, r.currency, r.billNo, totals.total, qrError]);

  const doc = useMemo(() => renderReceipt(r, totals, qr), [r, totals, qr]);
  const previewHtml = useMemo(() => previewDocument(doc.body, doc.css, { width: doc.width, margin: doc.side }), [doc]);

  async function create() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProgress(0);
    setResults([]);
    setNotes([]);
    try {
      const out = await typesetEngine.render(
        {
          blocks: [{ kind: 'html', html: doc.body }],
          css: doc.css,
          page: { width: doc.width, height: TALL, margin: { top: TOP, right: doc.side, bottom: 0, left: doc.side } },
          fontSize: doc.font,
          outline: false,
          pageNumbers: false,
          title: `${r.shopName} receipt ${r.billNo}`.trim(),
          lang: r.currency === 'INR' ? 'en-IN' : 'en',
        },
        {
          signal: controller.signal,
          onProgress: (d, _t, n) => {
            setProgress(d * 0.8);
            setNote(n);
          },
        },
      );
      if (out.pages > 1) throw new Error('This receipt is longer than a PDF page can be (about 4.9 m). Split it into two bills.');
      setNote('Fitting the length to the content');
      const fit = await contentBottom(out.blob);
      controller.signal.throwIfAborted();
      const pdf = await cropTop(out.blob, fit.bottom + BOTTOM);
      setProgress(0.9);
      setNote('Drawing the PNG');
      const pxWidth = Math.round((Number(r.paper) / 25.4) * dpi);
      const png = await pageToPng(pdf, pxWidth);
      controller.signal.throwIfAborted();
      const stem = fileStem(`receipt-${r.billNo || 'bill'}`, 'receipt');
      setResults([
        { id: newId('r'), name: `${stem}.pdf`, blob: pdf, url: URL.createObjectURL(pdf) },
        { id: newId('r'), name: `${stem}.png`, blob: png.blob, url: URL.createObjectURL(png.blob) },
      ]);
      const lengthMm = Math.round(((fit.bottom + BOTTOM) / 72) * 25.4);
      setNotes([
        { kind: 'ok', text: `${PAPERS[r.paper].label} wide × ${lengthMm} mm long. Total ${fmt(totals.total)}.` },
        { kind: 'info', text: `PNG: ${png.width} × ${png.height} px (${dpi} dpi). PDF text is real and selectable.` },
        ...(out.missing.length ? [{ kind: 'warn' as const, text: `Some characters could not be shown: ${out.missing.join(' ')}` }] : []),
      ]);
    } catch (err) {
      if (!isAbortError(err)) toast.error(err instanceof Error ? err.message : 'Could not create the receipt.');
      else toast.info('Cancelled.');
    } finally {
      abort.current = null;
      setRunning(false);
      setProgress(1);
      setNote(undefined);
    }
  }

  const taxed = r.taxMode !== 'none';
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Shop" contentClassName="grid gap-3 sm:grid-cols-2">
          <TextField label="Shop name" value={r.shopName} onChange={(shopName) => set({ shopName })} />
          <TextField label="GSTIN / tax number" value={r.gstin} onChange={(gstin) => set({ gstin })} maxLength={30} />
          <AreaField className="sm:col-span-2" label="Address and contact (one per line)" value={r.shopLines} onChange={(shopLines) => set({ shopLines })} rows={2} />
          <div className="sm:col-span-2">
            <SwitchRow
              id="pos-remember"
              label="Remember shop details on this device"
              checked={rememberShop}
              onChange={(on) => {
                setRememberShop(on);
                if (!on) {
                  try {
                    localStorage.removeItem(DRAFT_KEY);
                  } catch {
                    // ignore
                  }
                }
              }}
              hint="Keeps the name, address, tax number and footer in this browser only. Turn off to forget them."
            />
          </div>
        </SectionCard>

        <SectionCard title="Bill" contentClassName="grid gap-3 sm:grid-cols-4">
          <TextField label="Bill no." value={r.billNo} onChange={(billNo) => set({ billNo })} />
          <TextField label="Date and time" type="datetime-local" value={r.date} onChange={(date) => set({ date })} />
          <TextField label="Cashier" value={r.cashier} onChange={(cashier) => set({ cashier })} />
          <TextField label="Customer" value={r.customer} onChange={(customer) => set({ customer })} />
        </SectionCard>

        <SectionCard
          title="Items"
          description={`${r.items.length} ${r.items.length === 1 ? 'line' : 'lines'} · ${fmt(totals.subtotal)}`}
          contentClassName="flex flex-col gap-3"
        >
          <ul className="flex flex-col gap-2">
            {r.items.map((item, i) => (
              <ItemRow
                key={item.id}
                item={item}
                index={i}
                taxed={taxed}
                money={cur.symbol}
                canRemove={r.items.length > 1}
                onChange={(next) => setR((c) => ({ ...c, items: c.items.map((x, j) => (j === i ? next : x)) }))}
                onRemove={() => setR((c) => ({ ...c, items: c.items.filter((_, j) => j !== i) }))}
              />
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            disabled={r.items.length >= 300}
            onClick={() => setR((c) => ({ ...c, items: [...c.items, newReceiptItem({ taxRate: c.items.at(-1)?.taxRate ?? 5 })] }))}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Add item
          </Button>
        </SectionCard>

        <SectionCard title="Tax, discount and payment" contentClassName="grid gap-3 sm:grid-cols-2">
          <Field label="Tax">
            <Segmented<TaxMode>
              label="Tax"
              value={r.taxMode}
              options={[
                { value: 'none', label: 'None' },
                { value: 'inclusive', label: 'In prices' },
                { value: 'exclusive', label: 'Added' },
              ]}
              onChange={(taxMode) => set({ taxMode })}
            />
          </Field>
          <SelectField
            label="Currency"
            value={r.currency}
            options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))}
            onChange={(currency) => set({ currency })}
          />
          {taxed ? (
            <>
              <SwitchRow id="pos-split" label="Split into CGST + SGST" checked={r.gstSplit} onChange={(gstSplit) => set({ gstSplit })} />
              {r.gstSplit ? <span /> : <TextField label="Tax name" value={r.taxLabel} maxLength={20} onChange={(taxLabel) => set({ taxLabel })} />}
            </>
          ) : null}
          <Field label="Discount on the bill" htmlFor="pos-disc">
            <div className="flex items-center gap-1">
              <NumberInput
                id="pos-disc"
                className="min-w-0 flex-1"
                value={r.discount}
                min={0}
                max={r.discountKind === 'pct' ? 100 : 1e10}
                step={r.discountKind === 'pct' ? 1 : 0.01}
                onChange={(discount) => set({ discount })}
              />
              <Segmented<'pct' | 'amt'>
                label="Discount kind"
                value={r.discountKind}
                options={[
                  { value: 'pct', label: '%' },
                  { value: 'amt', label: cur.symbol },
                ]}
                onChange={(discountKind) => set({ discountKind, discount: 0 })}
              />
            </div>
          </Field>
          <div className="flex items-end pb-1">
            <SwitchRow id="pos-round" label="Round the total" checked={r.roundOff} onChange={(roundOff) => set({ roundOff })} />
          </div>
          <SelectField
            label="Paid by"
            value={PAYMENTS.includes(r.payment) ? r.payment : 'Cash'}
            options={PAYMENTS.map((p) => ({ value: p, label: p }))}
            onChange={(payment) => set({ payment, tendered: payment === 'Cash' ? r.tendered : 0 })}
          />
          {r.payment === 'Cash' ? (
            <Field label="Cash received (for change)" htmlFor="pos-tendered" hint={totals.tendered > 0 ? `Change ${fmt(Math.max(0, totals.change))}` : undefined}>
              <NumberInput id="pos-tendered" value={r.tendered} min={0} max={1e10} step={1} onChange={(tendered) => set({ tendered })} />
            </Field>
          ) : null}
        </SectionCard>

        <SectionCard title="Footer and QR code" contentClassName="grid gap-3 sm:grid-cols-2">
          <AreaField className="sm:col-span-2" label="Footer" value={r.footer} onChange={(footer) => set({ footer })} rows={2} />
          <Field label="QR code">
            <Segmented<QrKind>
              label="QR code"
              value={r.qrKind}
              options={[
                { value: 'none', label: 'None' },
                { value: 'upi', label: 'UPI payment' },
                { value: 'text', label: 'Link or text' },
              ]}
              onChange={(qrKind) => set({ qrKind, qrCaption: qrKind === 'upi' ? 'Scan to pay' : qrKind === 'text' ? 'Scan me' : r.qrCaption })}
            />
          </Field>
          {r.qrKind !== 'none' ? (
            <>
              <TextField
                label={r.qrKind === 'upi' ? 'UPI ID' : 'Link or text'}
                value={r.qrValue}
                placeholder={r.qrKind === 'upi' ? 'shop@bank' : 'https://…'}
                error={qrError}
                maxLength={1500}
                hint={r.qrKind === 'upi' && r.currency === 'INR' ? 'The QR asks for the bill total.' : undefined}
                onChange={(qrValue) => set({ qrValue })}
              />
              <TextField label="Caption" value={r.qrCaption} onChange={(qrCaption) => set({ qrCaption })} />
            </>
          ) : null}
        </SectionCard>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <SectionCard
          title="Receipt"
          description={`Total ${fmt(totals.total)}`}
          contentClassName="flex flex-col gap-3"
          action={
            <Segmented<PaperWidth>
              label="Paper width"
              value={r.paper}
              options={[
                { value: '58', label: '58 mm' },
                { value: '80', label: '80 mm' },
              ]}
              onChange={(paper) => set({ paper })}
            />
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<'mono' | 'sans'>
              label="Font"
              value={r.font}
              options={[
                { value: 'mono', label: 'Mono' },
                { value: 'sans', label: 'Sans' },
              ]}
              onChange={(font) => set({ font })}
            />
            <Segmented<Dpi>
              label="PNG resolution"
              value={dpi}
              options={[
                { value: 203, label: '203 dpi' },
                { value: 300, label: '300 dpi' },
              ]}
              onChange={setDpi}
            />
          </div>
          <div className="rounded-lg bg-muted/60 p-3">
            <div className="mx-auto" style={{ width: r.paper === '58' ? 230 : 300, maxWidth: '100%' }}>
              <HtmlPreview html={previewHtml} pageWidth={doc.width} maxHeight={640} title="Receipt preview" className="rounded-none" />
            </div>
          </div>
          <JsonButtons
            fileName={() => `${fileStem(`receipt-${r.billNo}`, 'receipt')}.json`}
            serialize={() => serializeReceipt(r)}
            onLoad={(text) => {
              setR(parseReceipt(text));
              setResults([]);
            }}
          />
          <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
        </SectionCard>
        <RunBar
          label="Create PDF and PNG"
          running={running}
          progress={progress}
          note={note}
          disabledReason={totals.subtotal > 0 ? null : 'Add an item with a price.'}
          onRun={create}
          onCancel={() => abort.current?.abort()}
        />
        {results.length ? <ResultRows results={results} notesFor={(x) => (x.name.endsWith('.pdf') ? notes : [])} zipName="receipt.zip" /> : null}
      </div>
    </div>
  );
}
