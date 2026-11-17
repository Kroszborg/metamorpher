'use client';

import { Camera01Icon, Delete02Icon, ImageUpload01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import type SignaturePad from 'signature_pad';
import { toast } from 'sonner';
import { Segmented } from '@/components/kit/segmented';
import { BlobImage, RangeField, SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionField } from '@/components/workbench';
import { cn } from '@/lib/utils';
import { type Ink, loadPhoto, removeBackground, renderTyped, trimCanvas } from './ink';
import { SCRIPT_FONTS } from './script-fonts';

type Mode = 'draw' | 'type' | 'image';

const INKS = [
  { value: '#111111', label: 'Black' },
  { value: '#1a3a8f', label: 'Blue' },
];

function InkPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Segmented
      label="Ink"
      value={value}
      options={INKS.map((i) => ({ value: i.value, label: i.label }))}
      onChange={onChange}
    />
  );
}

/** Drawing with signature_pad on a canvas that keeps its strokes across resizes. */
function DrawPad({ color, onCreate }: { color: string; onCreate: (ink: Ink) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pad: SignaturePad | null = null;
    let disposed = false;
    const fit = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const data = pad?.toData();
      canvas.width = Math.round(canvas.offsetWidth * ratio);
      canvas.height = Math.round(canvas.offsetHeight * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      if (pad) {
        pad.clear();
        if (data?.length) pad.fromData(data);
      }
    };
    const ro = new ResizeObserver(fit);
    void import('signature_pad').then(({ default: Pad }) => {
      if (disposed) return;
      fit();
      pad = new Pad(canvas, { minWidth: 0.8, maxWidth: 2.6, penColor: color });
      pad.addEventListener('endStroke', () => setEmpty(pad?.isEmpty() ?? true));
      padRef.current = pad;
      ro.observe(canvas);
    });
    return () => {
      disposed = true;
      ro.disconnect();
      pad?.off();
      padRef.current = null;
    };
    // The pen colour is applied below without recreating the pad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    pad.penColor = color;
    // Recolour what is already drawn.
    const data = pad.toData();
    if (data.length) pad.fromData(data.map((g) => ({ ...g, penColor: color })));
  }, [color]);

  const clear = () => {
    padRef.current?.clear();
    setEmpty(true);
  };

  const use = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !padRef.current || padRef.current.isEmpty()) return;
    const ink = await trimCanvas(canvas, 6);
    if (ink) {
      onCreate(ink);
      clear();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature drawing area"
          className="block h-36 w-full touch-none rounded-lg border bg-white"
        />
        {empty ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[0.7rem] text-neutral-400">
            Sign here with a mouse, pen or finger
          </span>
        ) : null}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-neutral-300" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          Clear
        </Button>
        <Button type="button" size="sm" onClick={use} disabled={empty}>
          Use signature
        </Button>
      </div>
    </div>
  );
}

function TypePad({ color, onCreate }: { color: string; onCreate: (ink: Ink) => void }) {
  const [name, setName] = useState('');
  const [fontId, setFontId] = useState(SCRIPT_FONTS[0]!.id);
  const font = SCRIPT_FONTS.find((f) => f.id === fontId) ?? SCRIPT_FONTS[0]!;

  const use = async () => {
    const ink = await renderTyped(name.trim(), font.fontFamily, color);
    if (ink) onCreate(ink);
  };

  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="Your name" placeholder="Your name" value={name} maxLength={80} onChange={(e) => setName(e.currentTarget.value)} />
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Signature style">
        {SCRIPT_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === fontId}
            aria-label={f.label}
            onClick={() => setFontId(f.id)}
            className={cn(
              'h-12 truncate rounded-lg border bg-white px-3 text-left text-2xl transition-colors',
              f.className,
              f.id === fontId ? 'ring-2 ring-primary' : 'hover:border-primary/50',
            )}
            style={{ color }}
          >
            {name.trim() || 'Your name'}
          </button>
        ))}
      </div>
      <Button type="button" size="sm" className="self-end" onClick={use} disabled={!name.trim()}>
        Use signature
      </Button>
    </div>
  );
}

function ImagePad({ onCreate }: { onCreate: (ink: Ink) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [threshold, setThreshold] = useState(170);
  const [preview, setPreview] = useState<Blob | null>(null);

  // Re-process the preview whenever the photo or settings change.
  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      removeBackground(photo, removeBg ? threshold : 256).toBlob((b) => {
        if (!cancelled && b) setPreview(b);
      }, 'image/png');
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [photo, removeBg, threshold]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await loadPhoto(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'This image could not be read.');
    }
  };

  const use = async () => {
    if (!photo) return;
    const ink = await trimCanvas(removeBackground(photo, removeBg ? threshold : 256), 2);
    if (ink) onCreate(ink);
    else toast.error('Nothing is left after removing the background. Lower the threshold.');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <HugeiconsIcon icon={ImageUpload01Icon} strokeWidth={2} />
          Choose image
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => cameraInput.current?.click()}>
          <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} />
          Take photo
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Signature image"
        onChange={(e) => {
          void pick(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Photograph a signature"
        onChange={(e) => {
          void pick(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      {photo ? (
        <>
          <div className="grid h-28 place-items-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:12px_12px] p-2">
            {preview ? <BlobImage blob={preview} className="max-h-full max-w-full object-contain" alt="Processed signature" /> : null}
          </div>
          <SwitchRow
            id="sig-remove-bg"
            label="Remove background"
            checked={removeBg}
            onChange={setRemoveBg}
            hint="Makes paper transparent. Works best with dark ink on white paper in even light."
          />
          {removeBg ? (
            <OptionField label="Threshold" htmlFor="sig-threshold" hint="Raise it if paper remains, lower it if strokes break up.">
              <RangeField id="sig-threshold" min={60} max={250} value={threshold} onChange={setThreshold} />
            </OptionField>
          ) : null}
          <Button type="button" size="sm" className="self-end" onClick={use}>
            Use signature
          </Button>
        </>
      ) : (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          A scan or photo of your signature on white paper.
        </p>
      )}
    </div>
  );
}

/** Draw, type or upload a signature; `onCreate` receives a trimmed transparent PNG. */
export function SignatureMaker({ onCreate }: { onCreate: (ink: Ink) => void }) {
  const [mode, setMode] = useState<Mode>('draw');
  const [color, setColor] = useState(INKS[0]!.value);
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Signature source"
        value={mode}
        options={[
          { value: 'draw', label: 'Draw' },
          { value: 'type', label: 'Type' },
          { value: 'image', label: 'Image' },
        ]}
        onChange={setMode}
      />
      {mode !== 'image' ? (
        <OptionField label="Ink">
          <InkPicker value={color} onChange={setColor} />
        </OptionField>
      ) : null}
      {mode === 'draw' ? <DrawPad color={color} onCreate={onCreate} /> : null}
      {mode === 'type' ? <TypePad color={color} onCreate={onCreate} /> : null}
      {mode === 'image' ? <ImagePad onCreate={onCreate} /> : null}
    </div>
  );
}
