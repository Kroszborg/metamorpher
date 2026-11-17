'use client';

import { Download04Icon, ImageUpload01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AreaField, Field, SelectField, TextField } from '@/components/business/form-bits';
import { imageFileToDataUrl } from '@/components/business/html';
import { drawQr, type Ecc, isUpiId, logoHole, qrMatrix, type QrMatrix, qrSvg, type QrStyle } from '@/components/business/qr';
import { CopyButton } from '@/components/kit/copy-button';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { ImagePicker, RangeField, SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { type Kind, type Upi, upiPayload, type VCard, vcardPayload, type Wifi, wifiPayload } from './payloads';

type Tab = 'qr' | 'barcode' | 'read';
type Shape = NonNullable<QrStyle['shape']>;

function canvasBlob(c: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The image could not be made.'))), type));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('This image could not be read.'));
    img.src = src;
  });
}

/** Draws the code (and the logo in its cleared centre) at `px` pixels per module. */
async function renderQr(canvas: HTMLCanvasElement, m: QrMatrix, px: number, style: QrStyle, logo: string | null, fraction: number) {
  canvas.width = canvas.height = m.size * px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const hole = logo ? logoHole(m, fraction) : null;
  drawQr(ctx, m, px, style, hole);
  if (logo && hole) {
    const img = await loadImage(logo);
    const box = (hole.x1 - hole.x0) * px;
    const pad = box * 0.08;
    const k = Math.min((box - 2 * pad) / img.width, (box - 2 * pad) / img.height);
    const w = img.width * k;
    const h = img.height * k;
    if (style.transparent) {
      ctx.clearRect(hole.x0 * px, hole.x0 * px, box, box);
    }
    ctx.drawImage(img, hole.x0 * px + (box - w) / 2, hole.x0 * px + (box - h) / 2, w, h);
  }
}

function QrMaker() {
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('https://example.com');
  const [wifi, setWifi] = useState<Wifi>({ ssid: '', password: '', security: 'WPA', hidden: false });
  const [vcard, setVcard] = useState<VCard>({ first: '', last: '', org: '', title: '', phone: '', email: '', url: '', address: '', note: '' });
  const [upi, setUpi] = useState<Upi>({ vpa: '', name: '', amount: '', note: '' });
  const [ecc, setEcc] = useState<Ecc>('M');
  const [fg, setFg] = useState('#111111');
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [shape, setShape] = useState<Shape>('square');
  const [logo, setLogo] = useState<string | null>(null);
  const [logoSize, setLogoSize] = useState(0.22);
  const [size, setSize] = useState(1024);
  const canvas = useRef<HTMLCanvasElement>(null);

  const payload = useMemo(() => {
    if (kind === 'text') return text;
    if (kind === 'wifi') return wifi.ssid.trim() ? wifiPayload(wifi) : '';
    if (kind === 'vcard') return vcard.first.trim() || vcard.last.trim() || vcard.org.trim() ? vcardPayload(vcard) : '';
    return isUpiId(upi.vpa) ? upiPayload(upi) : '';
  }, [kind, text, wifi, vcard, upi]);

  // A logo hides modules in the middle, so it needs the highest error correction.
  const level: Ecc = logo ? 'H' : ecc;
  const matrix = useMemo(() => {
    if (!payload) return { m: null, error: null as string | null };
    try {
      return { m: qrMatrix(payload, level, 4), error: null };
    } catch (err) {
      return { m: null, error: err instanceof Error ? err.message : 'Too much data.' };
    }
  }, [payload, level]);
  const style: QrStyle = { fg, bg, shape, transparent };
  const lowContrast = !transparent && contrast(fg, bg) < 3;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !matrix.m) return;
    void renderQr(c, matrix.m, Math.max(2, Math.floor(480 / matrix.m.size)), style, logo, logoSize);
    // style is rebuilt every render; its parts are listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix.m, fg, bg, shape, transparent, logo, logoSize]);

  async function savePng() {
    if (!matrix.m) return;
    const c = document.createElement('canvas');
    await renderQr(c, matrix.m, Math.max(1, Math.round(size / matrix.m.size)), style, logo, logoSize);
    downloadBlob(await canvasBlob(c), 'qr-code.png');
  }

  function saveSvg() {
    if (!matrix.m) return;
    const svg = qrSvg(matrix.m, style, { size, logo: logo ? { href: logo, fraction: logoSize } : undefined });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg');
  }

  async function savePdf() {
    if (!matrix.m) return;
    const m = matrix.m;
    const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
    const hex = (h: string) => rgb(Number.parseInt(h.slice(1, 3), 16) / 255, Number.parseInt(h.slice(3, 5), 16) / 255, Number.parseInt(h.slice(5, 7), 16) / 255);
    const pdf = await PDFDocument.create();
    pdf.setTitle('QR code');
    pdf.setProducer('Metamorpher');
    const side = 216; // 3 inches
    const mod = side / m.size;
    const page = pdf.addPage([side, side]);
    if (!transparent) page.drawRectangle({ x: 0, y: 0, width: side, height: side, color: hex(bg) });
    const hole = logo ? logoHole(m, logoSize) : null;
    const color = hex(fg);
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (!m.dark[y]?.[x]) continue;
        if (hole && x >= hole.x0 && x < hole.x1 && y >= hole.x0 && y < hole.x1) continue;
        const px = x * mod;
        const py = side - (y + 1) * mod;
        if (shape === 'dots' && !m.finder[y]?.[x]) page.drawCircle({ x: px + mod / 2, y: py + mod / 2, size: mod * 0.46, color });
        else page.drawRectangle({ x: px, y: py, width: mod + 0.02, height: mod + 0.02, color });
      }
    }
    if (logo && hole) {
      const bytes = new Uint8Array(await (await fetch(logo)).arrayBuffer());
      const img = logo.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const box = (hole.x1 - hole.x0) * mod;
      const pad = box * 0.08;
      const k = Math.min((box - 2 * pad) / img.width, (box - 2 * pad) / img.height);
      page.drawImage(img, { x: hole.x0 * mod + (box - img.width * k) / 2, y: side - hole.x1 * mod + (box - img.height * k) / 2, width: img.width * k, height: img.height * k });
    }
    downloadBlob(new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }), 'qr-code.pdf');
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard
          title="Content"
          contentClassName="grid gap-3 sm:grid-cols-2"
          action={
            <Segmented<Kind>
              label="Content type"
              value={kind}
              options={[
                { value: 'text', label: 'Link / text' },
                { value: 'wifi', label: 'Wi-Fi' },
                { value: 'vcard', label: 'Contact' },
                { value: 'upi', label: 'UPI' },
              ]}
              onChange={setKind}
            />
          }
        >
          {kind === 'text' ? <AreaField className="sm:col-span-2" label="Link or text" value={text} onChange={setText} rows={3} maxLength={2900} /> : null}
          {kind === 'wifi' ? (
            <>
              <TextField label="Network name (SSID)" value={wifi.ssid} onChange={(ssid) => setWifi({ ...wifi, ssid })} maxLength={64} />
              <SelectField
                label="Security"
                value={wifi.security}
                options={[
                  { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
                  { value: 'WEP', label: 'WEP' },
                  { value: 'nopass', label: 'None (open)' },
                ]}
                onChange={(v) => setWifi({ ...wifi, security: v as Wifi['security'] })}
              />
              {wifi.security !== 'nopass' ? <TextField label="Password" value={wifi.password} onChange={(password) => setWifi({ ...wifi, password })} maxLength={64} /> : null}
              <div className="flex items-end pb-1">
                <SwitchRow id="qr-hidden" label="Hidden network" checked={wifi.hidden} onChange={(hidden) => setWifi({ ...wifi, hidden })} />
              </div>
            </>
          ) : null}
          {kind === 'vcard' ? (
            <>
              <TextField label="First name" value={vcard.first} onChange={(first) => setVcard({ ...vcard, first })} />
              <TextField label="Last name" value={vcard.last} onChange={(last) => setVcard({ ...vcard, last })} />
              <TextField label="Organisation" value={vcard.org} onChange={(org) => setVcard({ ...vcard, org })} />
              <TextField label="Job title" value={vcard.title} onChange={(title) => setVcard({ ...vcard, title })} />
              <TextField label="Phone" value={vcard.phone} inputMode="tel" onChange={(phone) => setVcard({ ...vcard, phone })} />
              <TextField label="Email" value={vcard.email} inputMode="email" onChange={(email) => setVcard({ ...vcard, email })} />
              <TextField label="Website" value={vcard.url} inputMode="url" onChange={(url) => setVcard({ ...vcard, url })} />
              <TextField label="Address" value={vcard.address} onChange={(address) => setVcard({ ...vcard, address })} />
            </>
          ) : null}
          {kind === 'upi' ? (
            <>
              <TextField label="UPI ID" value={upi.vpa} placeholder="name@bank" error={upi.vpa && !isUpiId(upi.vpa) ? 'A UPI ID looks like name@bank.' : null} onChange={(vpa) => setUpi({ ...upi, vpa: vpa.trim() })} />
              <TextField label="Payee name" value={upi.name} onChange={(name) => setUpi({ ...upi, name })} />
              <TextField label="Amount (₹, optional)" value={upi.amount} inputMode="decimal" onChange={(amount) => setUpi({ ...upi, amount: amount.replace(/[^\d.]/g, '') })} />
              <TextField label="Note (optional)" value={upi.note} onChange={(note) => setUpi({ ...upi, note })} maxLength={80} />
            </>
          ) : null}
          {payload ? (
            <p className="truncate font-mono text-[0.7rem] text-muted-foreground sm:col-span-2" title={payload} data-payload>
              {payload.replace(/\r\n/g, ' ⏎ ')}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="Style" contentClassName="grid gap-3 sm:grid-cols-2">
          <Field label="Colours">
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Foreground colour" value={fg} onChange={(e) => setFg(e.currentTarget.value)} className="h-7 w-9 rounded border bg-transparent p-0.5" />
              <input type="color" aria-label="Background colour" value={bg} disabled={transparent} onChange={(e) => setBg(e.currentTarget.value)} className="h-7 w-9 rounded border bg-transparent p-0.5" />
              <SwitchRow id="qr-transparent" label="Transparent" checked={transparent} onChange={setTransparent} />
            </div>
          </Field>
          <Field label="Modules">
            <Segmented<Shape>
              label="Module shape"
              value={shape}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'dots', label: 'Dots' },
              ]}
              onChange={setShape}
            />
          </Field>
          <Field label="Error correction" hint={logo ? 'High (30%) while a logo covers the middle.' : 'Higher survives damage and dirt; lower holds more data.'}>
            <Segmented<Ecc>
              label="Error correction"
              value={level}
              options={[
                { value: 'L', label: 'L 7%' },
                { value: 'M', label: 'M 15%' },
                { value: 'Q', label: 'Q 25%' },
                { value: 'H', label: 'H 30%' },
              ]}
              onChange={setEcc}
            />
          </Field>
          <Field label="Logo in the middle">
            <div className="flex items-center gap-2">
              <ImagePicker
                id="qr-logo"
                value={null}
                label={logo ? 'Replace logo' : 'Add logo'}
                onChange={async (file) => {
                  if (!file) return;
                  try {
                    setLogo(await imageFileToDataUrl(file, 512));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'This image could not be read.');
                  }
                }}
              />
              {logo ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setLogo(null)}>
                  Remove
                </Button>
              ) : null}
            </div>
          </Field>
          {logo ? (
            <Field label="Logo size" htmlFor="qr-logo-size">
              <RangeField id="qr-logo-size" min={0.12} max={0.3} step={0.01} value={logoSize} onChange={setLogoSize} format={(v) => `${Math.round(v * 100)}%`} />
            </Field>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="QR code" description={matrix.m ? `Version ${matrix.m.version}, ${matrix.m.size - 8}×${matrix.m.size - 8} modules, level ${level}` : 'Fill in the content'} contentClassName="flex flex-col gap-3" className="lg:sticky lg:top-4">
        <div className="grid place-items-center rounded-lg bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
          {matrix.m ? <canvas ref={canvas} aria-label="QR code" className="h-auto w-full max-w-72" /> : <p className="py-16 text-xs text-muted-foreground">{matrix.error ?? 'Nothing to encode yet.'}</p>}
        </div>
        {lowContrast ? <p className="text-[0.7rem] text-warning">The colours are too close: scanners need a dark code on a light background.</p> : null}
        <Field label="PNG size" htmlFor="qr-size">
          <RangeField id="qr-size" min={256} max={4096} step={64} value={size} onChange={setSize} format={(v) => `${v}px`} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['PNG', savePng],
              ['SVG', saveSvg],
              ['PDF', savePdf],
            ] as const
          ).map(([label, fn]) => (
            <Button key={label} type="button" size="sm" disabled={!matrix.m} onClick={() => void fn()}>
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
              {label}
            </Button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/** WCAG contrast ratio of two hex colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const FORMATS = [
  { value: 'CODE128', label: 'Code 128 (any text)' },
  { value: 'EAN13', label: 'EAN-13 (12–13 digits)' },
  { value: 'EAN8', label: 'EAN-8 (7–8 digits)' },
  { value: 'UPC', label: 'UPC-A (11–12 digits)' },
  { value: 'CODE39', label: 'Code 39 (A–Z, 0–9)' },
  { value: 'ITF14', label: 'ITF-14 (13–14 digits)' },
] as const;

function BarcodeMaker() {
  const [format, setFormat] = useState<string>('CODE128');
  const [value, setValue] = useState('METAMORPHER-2026');
  const [showText, setShowText] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    let live = true;
    void import('jsbarcode').then(({ default: JsBarcode }) => {
      if (!live) return;
      try {
        let ok = true;
        JsBarcode(el, value, { format, displayValue: showText, width: 2, height: 90, margin: 12, font: 'monospace', fontSize: 16, valid: (v: boolean) => (ok = v) });
        setError(ok ? null : 'This value does not fit the chosen format.');
      } catch {
        setError('This value does not fit the chosen format.');
      }
    });
    return () => {
      live = false;
    };
  }, [format, value, showText]);

  const svgText = () => (svg.current ? new XMLSerializer().serializeToString(svg.current) : '');
  async function savePng() {
    const text = svgText();
    if (!text) return;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
    const k = 3;
    const c = document.createElement('canvas');
    c.width = img.width * k;
    c.height = img.height * k;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    downloadBlob(await canvasBlob(c), `barcode-${format.toLowerCase()}.png`);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <SectionCard title="Barcode" description="EAN and UPC check digits are added when you leave them out." contentClassName="grid gap-3 sm:grid-cols-2">
        <SelectField label="Format" value={format} options={FORMATS} onChange={setFormat} />
        <TextField label="Value" value={value} onChange={setValue} error={error} maxLength={80} />
        <SwitchRow id="bc-text" label="Show the value under the bars" checked={showText} onChange={setShowText} />
      </SectionCard>
      <SectionCard title="Preview" contentClassName="flex flex-col gap-3">
        <div className="overflow-x-auto rounded-lg border bg-white p-2">
          <svg ref={svg} aria-label="Barcode" className="mx-auto block max-w-full" />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={!!error} onClick={() => void savePng()}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            PNG
          </Button>
          <Button type="button" size="sm" disabled={!!error} onClick={() => downloadBlob(new Blob([svgText()], { type: 'image/svg+xml' }), `barcode-${format.toLowerCase()}.svg`)}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            SVG
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

type Found = { format: string; text: string };

function Reader() {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  async function read(file: File) {
    setBusy(true);
    setName(file.name);
    setFound(null);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * k);
      c.height = Math.round(bitmap.height * k);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas is not available.');
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      const out: Found[] = [];
      // The browser's own detector reads barcodes too where it exists (Android, macOS); jsQR reads QR everywhere.
      const Detector = (globalThis as { BarcodeDetector?: new () => { detect(s: ImageBitmap): Promise<{ format: string; rawValue: string }[]> } }).BarcodeDetector;
      if (Detector) {
        try {
          for (const r of await new Detector().detect(bitmap)) out.push({ format: r.format, text: r.rawValue });
        } catch {
          // Not supported for this image type.
        }
      }
      bitmap.close();
      if (!out.some((o) => o.format === 'qr_code')) {
        const { default: jsQR } = await import('jsqr');
        const data = ctx.getImageData(0, 0, c.width, c.height);
        const r = jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (r) out.push({ format: 'qr_code', text: r.data });
      }
      setFound(out);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'This image could not be read.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Read a QR code" description="From a photo or screenshot. The image is read on this device." contentClassName="flex flex-col gap-3">
      <Button type="button" variant="outline" className="self-start" disabled={busy} onClick={() => input.current?.click()}>
        <HugeiconsIcon icon={ImageUpload01Icon} strokeWidth={2} />
        {busy ? 'Reading…' : 'Choose an image'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Image with a QR code"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void read(f);
        }}
      />
      {found ? (
        found.length ? (
          <ul className="flex flex-col gap-2" data-decoded>
            {found.map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.7rem] text-muted-foreground">{f.format.replace('_', ' ').toUpperCase()}</p>
                  <p className="font-mono text-xs break-all whitespace-pre-wrap" data-decoded-text>
                    {f.text}
                  </p>
                </div>
                <CopyButton value={f.text} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No QR code found in {name}. Try a sharper, closer image.</p>
        )
      ) : null}
      <p className="text-[0.7rem]/relaxed text-muted-foreground">Links are shown, never opened automatically: check them before you visit.</p>
    </SectionCard>
  );
}

export default function QrCode(_props: ToolProps) {
  const [tab, setTab] = useState<Tab>('qr');
  return (
    <div className="flex flex-col gap-4">
      <Segmented<Tab>
        label="Mode"
        value={tab}
        options={[
          { value: 'qr', label: 'QR code' },
          { value: 'barcode', label: 'Barcode' },
          { value: 'read', label: 'Read' },
        ]}
        onChange={setTab}
      />
      {tab === 'qr' ? <QrMaker /> : tab === 'barcode' ? <BarcodeMaker /> : <Reader />}
    </div>
  );
}
