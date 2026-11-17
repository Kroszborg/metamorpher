'use client';

import {
  ArrowUpRight01Icon,
  Cursor01Icon,
  Delete02Icon,
  Image02Icon,
  PaintBrush01Icon,
  RedoIcon,
  SquareIcon,
  TextIcon,
  UndoIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { BlobImage, PdfStage, StageItem, type StageView, SwitchRow } from '@/components/pdf-stage';
import { ResultRows, ToolFrame, type ResultNote } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OptionField, OptionSelect, perFile, useWorkbench } from '@/components/workbench';
import type { Placement } from '@/engines/pdf-stamp/geometry';
import { typesetEngine } from '@/engines/typeset';
import { WorkerHost } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import type { EditWorkerApi } from './edit.worker';
import { LINE_HEIGHT, TEXT_PAD } from './layout';
import type { Align, EditItem, Family, Kind } from './types';

const host = new WorkerHost<EditWorkerApi>(() => new Worker(new URL('./edit.worker.ts', import.meta.url), { type: 'module' }));

type Options = { items: EditItem[]; onNotes: (id: string, n: ResultNote[]) => void };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

/** Our font families by the layout engine's names ("mm-<key>": the Noto/Caladea files in /vendor/fonts). */
const ENGINE_FAMILY: Record<Family, string> = { sans: 'mm-noto-sans', serif: 'mm-caladea', mono: 'mm-noto-sans-mono' };

/** Every text item laid out as its own page by the layout engine (shaping, any script, subsetted fonts). */
async function layOutText(items: EditItem[], signal: AbortSignal): Promise<{ items: EditItem[]; bytes?: Uint8Array; fonts: string[]; missing: string[] }> {
  const texts = items.filter((i) => i.kind === 'text' && (i.text ?? '').trim());
  if (texts.length === 0) return { items, fonts: [], missing: [] };
  const boxes = texts.map((i) => {
    const size = i.size ?? 14;
    const css = [
      `font-family:'${ENGINE_FAMILY[i.family ?? 'sans']}'`,
      `font-size:${size}pt`,
      `line-height:${LINE_HEIGHT}`,
      `color:${/^#[0-9a-f]{6}$/i.test(i.color ?? '') ? i.color : '#000000'}`,
      i.bold ? 'font-weight:bold' : '',
      i.italic ? 'font-style:italic' : '',
      `text-align:${i.align ?? 'left'}`,
      `padding:${TEXT_PAD}pt`,
      'white-space:pre-wrap',
      'margin:0',
    ].filter(Boolean);
    return { html: `<div style="${css.join(';')}">${esc((i.text ?? '').replace(/\t/g, '    '))}</div>`, width: i.placement.width, height: i.placement.height };
  });
  const out = await typesetEngine.textBoxes(boxes, 'body{margin:0;padding:0}', { signal });
  const pageOf = new Map(texts.map((t, k) => [t.id, k]));
  return { items: items.map((i) => (pageOf.has(i.id) ? { ...i, textPage: pageOf.get(i.id) } : i)), bytes: out.bytes, fonts: out.fonts, missing: out.missing };
}

const job = perFile<Options>(async (input, o, ctx) => {
  if (o.items.length === 0) throw new Error('Add something to a page first.');
  ctx.onProgress(0.05, 'Laying out the text');
  const laid = await layOutText(o.items, ctx.signal);
  if (laid.missing.length) throw new Error(`The text uses characters no font here can draw (${laid.missing.slice(0, 5).join(' ')}).`);
  ctx.onProgress(0.3, 'Writing the changes');
  const { blob, written } = await host.call((api) => api.apply(input.file, laid.items, laid.bytes), ctx.signal);
  o.onNotes(input.id, [
    {
      kind: 'ok',
      text: `${written} ${written === 1 ? 'item' : 'items'} added as page content (vector shapes, images, and text in embedded fonts that stays selectable).`,
    },
    ...(laid.fonts.length ? [{ kind: 'info' as const, text: `Fonts embedded for the text: ${laid.fonts.join(', ')} (only the characters used).` }] : []),
    ...(o.items.some((i) => i.kind === 'whiteout')
      ? [{ kind: 'warn' as const, text: 'Whiteout only covers content: the text underneath is still in the file. Use Redact PDF to remove it.' }]
      : []),
  ]);
  return { name: `${baseName(input.file.name)}-edited.pdf`, blob };
});

type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink' | 'highlight' | 'whiteout';
const TOOLS: { id: Tool; label: string; icon?: typeof TextIcon }[] = [
  { id: 'select', label: 'Select', icon: Cursor01Icon },
  { id: 'text', label: 'Text', icon: TextIcon },
  { id: 'rect', label: 'Rectangle', icon: SquareIcon },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight01Icon },
  { id: 'ink', label: 'Draw', icon: PaintBrush01Icon },
  { id: 'highlight', label: 'Highlight' },
  { id: 'whiteout', label: 'Whiteout' },
];
const CSS_FAMILY: Record<Family, string> = {
  sans: '"Noto Sans", Arial, sans-serif',
  serif: 'Caladea, Cambria, Georgia, serif',
  mono: '"Noto Sans Mono", Consolas, monospace',
};

let nextId = 1;
const newId = () => `e${nextId++}`;

function defaults(kind: Kind): Partial<EditItem> {
  switch (kind) {
    case 'text':
      return { text: 'Text', family: 'sans', size: 14, color: '#111111', align: 'left', bold: false, italic: false };
    case 'rect':
    case 'ellipse':
      return { color: '#d92d20', fill: null, strokeWidth: 2 };
    case 'line':
    case 'arrow':
      return { color: '#d92d20', strokeWidth: 2, direction: 'down' };
    case 'ink':
      return { color: '#1d4ed8', strokeWidth: 2 };
    case 'highlight':
      return { fill: '#ffe14d' };
    case 'whiteout':
      return { fill: '#ffffff' };
    default:
      return {};
  }
}

/** What an item looks like on the stage (the worker draws the same thing into the PDF). */
function ItemVisual({ item, scale }: { item: EditItem; scale: number }) {
  const w = item.placement.width * scale;
  const h = item.placement.height * scale;
  const sw = (item.strokeWidth ?? 2) * scale;
  const color = item.color ?? '#000';
  switch (item.kind) {
    case 'image':
      return item.image ? <BlobImage blob={item.image} className="size-full" /> : null;
    case 'whiteout':
      return <div className="size-full" style={{ background: item.fill ?? '#fff' }} />;
    case 'highlight':
      return <div className="size-full mix-blend-multiply" style={{ background: item.fill ?? '#ffe14d', opacity: 0.45 }} />;
    case 'text':
      return (
        <div
          className="size-full overflow-visible break-words whitespace-pre-wrap"
          style={{
            fontFamily: CSS_FAMILY[item.family ?? 'sans'],
            fontSize: (item.size ?? 14) * scale,
            lineHeight: LINE_HEIGHT,
            color,
            fontWeight: item.bold ? 700 : 400,
            fontStyle: item.italic ? 'italic' : 'normal',
            textAlign: item.align ?? 'left',
            padding: TEXT_PAD * scale,
          }}
        >
          {item.text}
        </div>
      );
    default: {
      let shape: React.ReactNode = null;
      if (item.kind === 'rect') shape = <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} />;
      else if (item.kind === 'ellipse') shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, (w - sw) / 2)} ry={Math.max(0, (h - sw) / 2)} />;
      else if (item.kind === 'line' || item.kind === 'arrow') {
        const [x0, y0, x1, y1] = item.direction === 'up' ? [0, h, w, 0] : [0, 0, w, h];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const ux = (x1 - x0) / len;
        const uy = (y1 - y0) / len;
        const head = Math.min(len * 0.45, Math.max(8 * scale, sw * 4));
        const bx = x1 - ux * head;
        const by = y1 - uy * head;
        const half = head * 0.45;
        shape = (
          <>
            <line x1={x0} y1={y0} x2={item.kind === 'arrow' ? bx : x1} y2={item.kind === 'arrow' ? by : y1} />
            {item.kind === 'arrow' ? (
              <polygon points={`${x1},${y1} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`} fill={color} stroke="none" />
            ) : null}
          </>
        );
      } else if (item.kind === 'ink') {
        shape = (item.strokes ?? []).map((s, i) => <polyline key={i} points={s.map(([u, v]) => `${u * w},${v * h}`).join(' ')} fill="none" />);
      }
      return (
        <svg className="size-full overflow-visible" viewBox={`0 0 ${w} ${h}`}>
          <g stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill={item.fill ?? 'none'}>
            {shape}
          </g>
        </svg>
      );
    }
  }
}

/** Drag on the page to create an item (or draw ink) with the current tool. */
function CreateLayer({ view, tool, onCreate }: { view: StageView; tool: Tool; onCreate: (kind: Kind, placement: Placement, extra: Partial<EditItem>) => void }) {
  const [drag, setDrag] = useState<{ pts: [number, number][] } | null>(null);
  const local = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(Math.max(0, e.clientX - r.left), view.width), Math.min(Math.max(0, e.clientY - r.top), view.height)];
  };
  const finish = () => {
    const pts = drag?.pts ?? [];
    setDrag(null);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last || tool === 'select') return;
    const s = view.scale;
    if (tool === 'ink') {
      if (pts.length < 2) return;
      const pad = 2 * s;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs) - pad;
      const y0 = Math.min(...ys) - pad;
      const bw = Math.max(...xs) + pad - x0;
      const bh = Math.max(...ys) + pad - y0;
      const [cx, cy] = view.toUser(x0 + bw / 2, y0 + bh / 2);
      onCreate('ink', { cx, cy, width: bw / s, height: bh / s, rotation: 0 }, { strokes: [pts.map(([x, y]) => [(x - x0) / bw, (y - y0) / bh])] });
      return;
    }
    let [sx, sy] = first;
    let dx = last[0] - sx;
    let dy = last[1] - sy;
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      // A click: a sensible default size around the point.
      const [dw, dh] = tool === 'text' ? [220, 28] : tool === 'line' || tool === 'arrow' ? [120, 60] : tool === 'highlight' ? [160, 16] : [140, 90];
      dx = dw * s;
      dy = dh * s;
      sx -= dx / 2;
      sy -= dy / 2;
    }
    const x0 = Math.min(sx, sx + dx);
    const y0 = Math.min(sy, sy + dy);
    const bw = Math.max(4, Math.abs(dx));
    const bh = Math.max(4, Math.abs(dy));
    const [cx, cy] = view.toUser(x0 + bw / 2, y0 + bh / 2);
    onCreate(tool, { cx, cy, width: bw / s, height: bh / s, rotation: 0 }, tool === 'line' || tool === 'arrow' ? { direction: dx * dy >= 0 ? 'down' : 'up' } : {});
  };
  const pts = drag?.pts ?? [];
  const a = pts[0];
  const b = pts[pts.length - 1];
  return (
    <div
      className="absolute inset-0 cursor-crosshair touch-none select-none"
      data-create-layer={tool}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ pts: [local(e)] });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = local(e);
        setDrag({ pts: tool === 'ink' ? [...drag.pts, p] : [drag.pts[0] ?? p, p] });
      }}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      {a && b ? (
        tool === 'ink' ? (
          <svg className="absolute inset-0 size-full">
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#1d4ed8" strokeWidth={2 * view.scale} strokeLinecap="round" />
          </svg>
        ) : (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
            style={{ left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }}
          />
        )
      ) : null}
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs font-medium">
      {label}
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent" />
    </label>
  );
}

function Properties({ item, onChange, onDelete }: { item: EditItem; onChange: (patch: Partial<EditItem>) => void; onDelete: () => void }) {
  const k = item.kind;
  return (
    <div className="flex flex-col gap-3" data-properties={k}>
      {k === 'text' ? (
        <>
          <OptionField label="Text" htmlFor="ed-text">
            <Textarea id="ed-text" value={item.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} rows={3} />
          </OptionField>
          <OptionField label="Font" htmlFor="ed-family">
            <OptionSelect<Family>
              id="ed-family"
              value={item.family ?? 'sans'}
              options={[
                { value: 'sans', label: 'Sans (Noto Sans)' },
                { value: 'serif', label: 'Serif (Caladea)' },
                { value: 'mono', label: 'Mono (Noto Sans Mono)' },
              ]}
              onChange={(family) => onChange({ family })}
            />
          </OptionField>
          <OptionField label="Size (pt)" htmlFor="ed-size">
            <input
              id="ed-size"
              type="number"
              min={4}
              max={200}
              value={item.size ?? 14}
              onChange={(e) => onChange({ size: Math.max(4, Math.min(200, Number(e.target.value) || 14)) })}
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
            />
          </OptionField>
          <div className="flex gap-4">
            <SwitchRow id="ed-bold" label="Bold" checked={!!item.bold} onChange={(bold) => onChange({ bold })} />
            <SwitchRow id="ed-italic" label="Italic" checked={!!item.italic} onChange={(italic) => onChange({ italic })} />
          </div>
          <OptionField label="Align">
            <Segmented<Align>
              label="Align"
              value={item.align ?? 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(align) => onChange({ align })}
            />
          </OptionField>
          <ColorField id="ed-color" label="Colour" value={item.color ?? '#111111'} onChange={(color) => onChange({ color })} />
        </>
      ) : null}
      {k === 'rect' || k === 'ellipse' || k === 'line' || k === 'arrow' || k === 'ink' ? (
        <>
          <ColorField id="ed-stroke" label="Line colour" value={item.color ?? '#000000'} onChange={(color) => onChange({ color })} />
          <OptionField label={`Line width: ${item.strokeWidth ?? 2} pt`} htmlFor="ed-width">
            <input
              id="ed-width"
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={item.strokeWidth ?? 2}
              onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
              className="accent-primary"
            />
          </OptionField>
        </>
      ) : null}
      {k === 'rect' || k === 'ellipse' ? (
        <>
          <SwitchRow id="ed-filled" label="Filled" checked={item.fill != null} onChange={(on) => onChange({ fill: on ? '#fde68a' : null })} />
          {item.fill != null ? <ColorField id="ed-fill" label="Fill colour" value={item.fill} onChange={(fill) => onChange({ fill })} /> : null}
        </>
      ) : null}
      {k === 'line' || k === 'arrow' ? (
        <Button size="sm" variant="outline" onClick={() => onChange({ direction: item.direction === 'up' ? 'down' : 'up' })}>
          Flip direction
        </Button>
      ) : null}
      {k === 'highlight' ? <ColorField id="ed-hl" label="Colour" value={item.fill ?? '#ffe14d'} onChange={(fill) => onChange({ fill })} /> : null}
      {k === 'whiteout' ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">Whiteout covers what is under it but does not remove it from the file. To remove text for good, use Redact PDF.</p>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onDelete} className="self-start text-destructive">
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        Delete
      </Button>
    </div>
  );
}

export default function EditPdf({ tool }: ToolProps) {
  const [items, setItemsRaw] = useState<EditItem[]>([]);
  const [past, setPast] = useState<EditItem[][]>([]);
  const [future, setFuture] = useState<EditItem[][]>([]);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, ResultNote[]>>({});
  const onNotes = useCallback((id: string, n: ResultNote[]) => setNotes((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ items, onNotes }), [items, onNotes]);
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;
  const view = useRef<StageView | null>(null);
  const lastRecord = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const imageInput = useRef<HTMLInputElement>(null);

  // Undo history: one snapshot per gesture or burst of typing.
  const record = useCallback(
    (key: string) => {
      const now = Date.now();
      if (key && lastRecord.current.key === key && now - lastRecord.current.at < 800) {
        lastRecord.current.at = now;
        return;
      }
      lastRecord.current = { key, at: now };
      setPast((p) => [...p.slice(-99), items]);
      setFuture([]);
    },
    [items],
  );
  const commit = (next: EditItem[], key = '') => {
    record(key);
    setItemsRaw(next);
  };
  const undo = useCallback(() => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([items, ...future]);
    setItemsRaw(prev);
    lastRecord.current = { key: '', at: 0 };
  }, [past, future, items]);
  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, items]);
    setItemsRaw(next);
    lastRecord.current = { key: '', at: 0 };
  }, [past, future, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // A new file starts empty.
  const [seen, setSeen] = useState<string | null>(null);
  if ((input?.id ?? null) !== seen) {
    setSeen(input?.id ?? null);
    setItemsRaw([]);
    setPast([]);
    setFuture([]);
    setPage(0);
    setSelected(null);
  }

  const create = (kind: Kind, placement: Placement, extra: Partial<EditItem>) => {
    const item: EditItem = { id: newId(), page, kind, placement, ...defaults(kind), ...extra };
    commit([...items, item]);
    setSelected(item.id);
    setMode('select');
  };

  const addImage = async (file: File) => {
    const v = view.current;
    if (!v) return;
    let w = 200;
    let h = 150;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, (v.frame.width * 0.5) / bmp.width, (v.frame.height * 0.5) / bmp.height);
      w = Math.max(16, bmp.width * k);
      h = Math.max(16, bmp.height * k);
      bmp.close();
    } catch {
      return;
    }
    const [cx, cy] = v.toUser(v.width / 2, v.height / 2);
    create('image', { cx, cy, width: w, height: h, rotation: 0 }, { image: file });
  };

  const sel = items.find((i) => i.id === selected) ?? null;
  const patch = (id: string, p: Partial<EditItem>, key: string) => commit(items.map((i) => (i.id === id ? { ...i, ...p } : i)), key);
  const remove = (id: string) => {
    commit(items.filter((i) => i.id !== id));
    setSelected(null);
  };

  const stage = input ? (
    <SectionCard title="Edit pages" description="Pick a tool, then click or drag on the page. Select an item to move, resize, rotate or change it." contentClassName="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <Button key={t.id} size="sm" variant={mode === t.id ? 'default' : 'outline'} onClick={() => setMode(t.id)} aria-pressed={mode === t.id} data-tool={t.id}>
            {t.icon ? <HugeiconsIcon icon={t.icon} strokeWidth={2} /> : null}
            {t.label}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => imageInput.current?.click()} data-tool="image">
          <HugeiconsIcon icon={Image02Icon} strokeWidth={2} />
          Image
        </Button>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          data-image-input=""
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void addImage(f);
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={undo} disabled={!past.length} aria-label="Undo">
          <HugeiconsIcon icon={UndoIcon} strokeWidth={2} />
        </Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={!future.length} aria-label="Redo">
          <HugeiconsIcon icon={RedoIcon} strokeWidth={2} />
        </Button>
      </div>
      <PdfStage
        file={input.file}
        page={page}
        onPageChange={(p) => {
          setPage(p);
          setSelected(null);
        }}
        onViewChange={(v) => {
          view.current = v;
        }}
        onPagePointerDown={() => setSelected(null)}
        overlay={(v) => (
          <>
            {items
              .filter((i) => i.page === page)
              .map((i) => (
                <div key={i.id} onPointerDownCapture={() => record(`drag-${i.id}-${Date.now()}`)} className={cn(mode !== 'select' && 'pointer-events-none')}>
                  <StageItem
                    view={v}
                    placement={i.placement}
                    onChange={(placement) => setItemsRaw((all) => all.map((x) => (x.id === i.id ? { ...x, placement } : x)))}
                    selected={selected === i.id}
                    onSelect={() => setSelected(i.id)}
                    onDelete={() => remove(i.id)}
                    lockAspect={i.kind === 'image'}
                    minSize={4}
                    label={i.kind}
                  >
                    <ItemVisual item={i} scale={v.scale} />
                  </StageItem>
                </div>
              ))}
            {mode !== 'select' ? <CreateLayer view={v} tool={mode} onCreate={create} /> : null}
          </>
        )}
      />
      <p className="text-[0.7rem] text-muted-foreground" data-item-count={items.length}>
        {items.length} {items.length === 1 ? 'item' : 'items'} added. Ctrl+Z undoes, Ctrl+Y redoes; Delete removes the selected item.
      </p>
    </SectionCard>
  ) : null;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      multiple={false}
      runLabel="Save PDF"
      disabledReason={items.length ? null : 'Add text, a shape, a drawing or an image to a page first.'}
      aside={stage}
      optionsPanel={
        sel ? (
          <Properties item={sel} onChange={(p) => patch(sel.id, p, `prop-${sel.id}-${Object.keys(p).join()}`)} onDelete={() => remove(sel.id)} />
        ) : (
          <p className="text-xs/relaxed text-muted-foreground">
            Add text boxes, images, shapes, arrows, freehand drawing, highlights and whiteout, then save: they become part of the page
            (vector shapes and real, selectable text with embedded fonts). Editing the PDF’s existing text comes later. Select an item to
            change its look.
          </p>
        )
      }
    >
      <ResultRows results={wb.results} notesFor={(r) => (r.sourceId ? (notes[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
