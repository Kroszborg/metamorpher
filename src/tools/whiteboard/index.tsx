'use client';

import {
  ArrowUpRight01Icon,
  CircleIcon,
  Cursor01Icon,
  Delete02Icon,
  Download04Icon,
  EraserIcon,
  HighlighterIcon,
  Image01Icon,
  MinusSignIcon,
  NoteIcon,
  PencilIcon,
  RedoIcon,
  SquareIcon,
  TextIcon,
  UndoIcon,
  Move01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { imageFileToDataUrl } from '@/components/business/html';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import { loadHand } from '../text-to-handwriting/fonts';
import {
  type Board,
  boardSvg,
  bounds,
  type Box,
  clearBoard,
  DEFS,
  type El,
  elementSvg,
  hit,
  loadBoard,
  moved,
  NOTE_COLORS,
  resized,
  saveBoard,
  type Stroke,
  type Tool,
  uid,
  unionBounds,
  type View,
} from './model';

const COLORS = ['#1c1c1c', '#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df'];
const HIGHLIGHT = ['#ffd33d', '#7ee787', '#79c0ff', '#ff9bce'];
const WIDTHS = [2, 4, 8];

const TOOLS: { id: Tool; label: string; key: string; icon: typeof PencilIcon }[] = [
  { id: 'select', label: 'Select and move (V)', key: 'v', icon: Cursor01Icon },
  { id: 'pan', label: 'Pan (H, or hold Space)', key: 'h', icon: Move01Icon },
  { id: 'pen', label: 'Pen (P)', key: 'p', icon: PencilIcon },
  { id: 'highlighter', label: 'Highlighter (M)', key: 'm', icon: HighlighterIcon },
  { id: 'eraser', label: 'Eraser (E)', key: 'e', icon: EraserIcon },
  { id: 'rect', label: 'Rectangle (R)', key: 'r', icon: SquareIcon },
  { id: 'ellipse', label: 'Ellipse (O)', key: 'o', icon: CircleIcon },
  { id: 'line', label: 'Line (L)', key: 'l', icon: MinusSignIcon },
  { id: 'arrow', label: 'Arrow (A)', key: 'a', icon: ArrowUpRight01Icon },
  { id: 'text', label: 'Text (T)', key: 't', icon: TextIcon },
  { id: 'note', label: 'Sticky note (N)', key: 'n', icon: NoteIcon },
];

const ElementView = memo(function ElementView({ el }: { el: El }) {
  return <g data-el={el.id} dangerouslySetInnerHTML={{ __html: elementSvg(el) }} />;
});

type Gesture =
  | { kind: 'draw'; id: string }
  | { kind: 'shape'; id: string; x: number; y: number }
  | { kind: 'move'; x: number; y: number; ids: Set<string> }
  | { kind: 'resize'; from: { x: number; y: number; w: number; h: number }; corner: [number, number]; ids: Set<string>; start: El[] }
  | { kind: 'marquee'; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'erase' }
  | { kind: 'pinch'; d: number; mx: number; my: number; view: View };

async function fontCss(): Promise<string> {
  try {
    const buf = await (await fetch('/vendor/handwriting/caveat-latin-400-normal.woff2')).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `<style>@font-face{font-family:'mm-hand-caveat';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}</style>`;
  } catch {
    return '';
  }
}

export default function Whiteboard(_props: ToolProps) {
  const [els, setEls] = useState<El[]>([]);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [hiColor, setHiColor] = useState(HIGHLIGHT[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const past = useRef<El[][]>([]);
  const future = useRef<El[][]>([]);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const before = useRef<El[] | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const elsRef = useRef(els);
  useEffect(() => {
    elsRef.current = els;
  });
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadHand('caveat').catch(() => undefined);
    void loadBoard().then((b) => {
      if (b) {
        setEls(b.elements);
        setView(b.view);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void saveBoard({ elements: els, view } satisfies Board), 500);
    return () => clearTimeout(t);
  }, [els, view, loaded]);

  const commit = useCallback((prev: El[]) => {
    past.current.push(prev);
    if (past.current.length > 150) past.current.shift();
    future.current = [];
    setHist({ undo: past.current.length, redo: future.current.length });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(elsRef.current);
    setEls(prev);
    setSelected(new Set());
    setHist({ undo: past.current.length, redo: future.current.length });
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(elsRef.current);
    setEls(next);
    setHist({ undo: past.current.length, redo: future.current.length });
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svg.current?.getBoundingClientRect();
      const x = clientX - (r?.left ?? 0);
      const y = clientY - (r?.top ?? 0);
      return { x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom, sx: x, sy: y };
    },
    [view],
  );

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v) => {
      const zoom = Math.min(8, Math.max(0.1, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
    });
  }, []);

  // Wheel: pan, Ctrl/⌘ + wheel (and trackpad pinch) zoom. Not passive, to stop the page scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0025));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const deleteSelected = useCallback(() => {
    if (!selected.size) return;
    commit(elsRef.current);
    setEls((all) => all.filter((e) => !selected.has(e.id)));
    setSelected(new Set());
  }, [selected, commit]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setTool('select');
        setSelected(new Set(elsRef.current.map((x) => x.id)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Escape') {
        setSelected(new Set());
      } else if (e.key === ' ') {
        if (!spaceDown) setSpaceDown(true);
        e.preventDefault();
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [editing, selected, spaceDown, undo, redo, deleteSelected]);

  const selectionBox = selected.size ? unionBounds(els.filter((e) => selected.has(e.id))) : null;

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (editing) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, { x: p.sx, y: p.sy });
    // Two fingers: pinch to zoom and pan, dropping what the first finger started.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (before.current && gesture.current && (gesture.current.kind === 'draw' || gesture.current.kind === 'shape')) setEls(before.current);
      before.current = null;
      gesture.current = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view };
      return;
    }
    if (pointers.current.size > 2) return;
    const active: Tool = spaceDown || e.button === 1 ? 'pan' : tool;
    before.current = els;
    const tol = 6 / view.zoom;
    switch (active) {
      case 'pan':
        gesture.current = { kind: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y };
        break;
      case 'pen':
      case 'highlighter': {
        const id = uid();
        const s: Stroke = { id, type: active === 'pen' ? 'stroke' : 'highlight', color: active === 'pen' ? color : hiColor, width, points: [[p.x, p.y, e.pointerType === 'pen' ? e.pressure : 0.5]] };
        setEls((all) => [...all, s]);
        gesture.current = { kind: 'draw', id };
        break;
      }
      case 'eraser':
        gesture.current = { kind: 'erase' };
        setEls((all) => all.filter((x) => !hit(x, p.x, p.y, tol)));
        break;
      case 'rect':
      case 'ellipse': {
        const id = uid();
        setEls((all) => [...all, { id, type: active, color, width, x: p.x, y: p.y, w: 0, h: 0 }]);
        gesture.current = { kind: 'shape', id, x: p.x, y: p.y };
        break;
      }
      case 'line':
      case 'arrow': {
        const id = uid();
        setEls((all) => [...all, { id, type: active, color, width, x1: p.x, y1: p.y, x2: p.x, y2: p.y }]);
        gesture.current = { kind: 'shape', id, x: p.x, y: p.y };
        break;
      }
      case 'text':
      case 'note': {
        // No mouse-down default: it would move focus away from the text box opened below.
        e.preventDefault();
        const id = uid();
        const box: Box =
          active === 'note'
            ? { id, type: 'note', color: '#1c1c1c', width: 2, x: p.x - 90, y: p.y - 70, w: 180, h: 140, text: '', fill: NOTE_COLORS[els.filter((x) => x.type === 'note').length % NOTE_COLORS.length] }
            : { id, type: 'text', color, width: Math.max(4, width * 1.5), x: p.x, y: p.y - 12, w: 240, h: 40, text: '' };
        commit(els);
        setEls((all) => [...all, box]);
        setSelected(new Set([id]));
        setEditing(id);
        before.current = null;
        gesture.current = null;
        break;
      }
      case 'select': {
        // Resize handles of the current selection first.
        if (selectionBox) {
          const corners: [number, number][] = [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ];
          for (const c of corners) {
            const hx = selectionBox.x + c[0] * selectionBox.w;
            const hy = selectionBox.y + c[1] * selectionBox.h;
            if (Math.abs(p.x - hx) <= 9 / view.zoom && Math.abs(p.y - hy) <= 9 / view.zoom) {
              gesture.current = { kind: 'resize', from: selectionBox, corner: c, ids: new Set(selected), start: els.filter((x) => selected.has(x.id)) };
              return;
            }
          }
        }
        const target = [...els].reverse().find((x) => hit(x, p.x, p.y, tol));
        if (target) {
          const next = e.shiftKey ? new Set(selected).add(target.id) : selected.has(target.id) ? selected : new Set([target.id]);
          setSelected(next);
          gesture.current = { kind: 'move', x: p.x, y: p.y, ids: next };
        } else {
          setSelected(new Set());
          gesture.current = { kind: 'marquee', x: p.x, y: p.y };
          setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
        }
        break;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: p.sx, y: p.sy });
    const g = gesture.current;
    if (!g) return;
    switch (g.kind) {
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const zoom = Math.min(8, Math.max(0.1, g.view.zoom * (d / (g.d || 1))));
        const k = zoom / g.view.zoom;
        setView({ zoom, x: mx - (g.mx - g.view.x) * k, y: my - (g.my - g.view.y) * k });
        break;
      }
      case 'pan':
        setView((v) => ({ ...v, x: g.vx + p.sx - g.sx, y: g.vy + p.sy - g.sy }));
        break;
      case 'draw': {
        const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
        const pts = events.map((ev) => {
          const w = toWorld(ev.clientX, ev.clientY);
          return [w.x, w.y, ev.pointerType === 'pen' ? ev.pressure : 0.5] as [number, number, number];
        });
        setEls((all) => all.map((x) => (x.id === g.id && (x.type === 'stroke' || x.type === 'highlight') ? { ...x, points: [...x.points, ...pts] } : x)));
        break;
      }
      case 'erase':
        setEls((all) => all.filter((x) => !hit(x, p.x, p.y, 6 / view.zoom)));
        break;
      case 'shape':
        setEls((all) =>
          all.map((x) => {
            if (x.id !== g.id) return x;
            if (x.type === 'line' || x.type === 'arrow') return { ...x, x2: p.x, y2: p.y };
            if (x.type === 'rect' || x.type === 'ellipse') {
              let w = p.x - g.x;
              let h = p.y - g.y;
              if (e.shiftKey) w = h = Math.sign(w || 1) * Math.max(Math.abs(w), Math.abs(h)) * (Math.sign(h || 1) === Math.sign(w || 1) ? 1 : 1);
              return { ...x, x: w < 0 ? g.x + w : g.x, y: h < 0 ? g.y + h : g.y, w: Math.abs(w), h: Math.abs(h) };
            }
            return x;
          }),
        );
        break;
      case 'move': {
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        g.x = p.x;
        g.y = p.y;
        setEls((all) => all.map((x) => (g.ids.has(x.id) ? moved(x, dx, dy) : x)));
        break;
      }
      case 'resize': {
        const f = g.from;
        const ax = f.x + (1 - g.corner[0]) * f.w;
        const ay = f.y + (1 - g.corner[1]) * f.h;
        const to = { x: Math.min(ax, p.x), y: Math.min(ay, p.y), w: Math.max(4, Math.abs(p.x - ax)), h: Math.max(4, Math.abs(p.y - ay)) };
        const startById = new Map(g.start.map((x) => [x.id, x]));
        setEls((all) => all.map((x) => (g.ids.has(x.id) ? resized(startById.get(x.id) as El, f, to) : x)));
        break;
      }
      case 'marquee':
        setMarquee({ x: Math.min(g.x, p.x), y: Math.min(g.y, p.y), w: Math.abs(p.x - g.x), h: Math.abs(p.y - g.y) });
        break;
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g?.kind === 'marquee' && marquee) {
      const inside = els.filter((x) => {
        const b = bounds(x);
        return b.x >= marquee.x && b.y >= marquee.y && b.x + b.w <= marquee.x + marquee.w && b.y + b.h <= marquee.y + marquee.h;
      });
      setSelected(new Set(inside.map((x) => x.id)));
      setMarquee(null);
    }
    if (g?.kind === 'shape') {
      // Drop shapes that were a click, not a drag.
      setEls((all) => all.filter((x) => x.id !== g.id || bounds(x).w + bounds(x).h > 10 / view.zoom));
    }
    if (before.current && before.current !== elsRef.current) commit(before.current);
    before.current = null;
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const p = toWorld(e.clientX, e.clientY);
    const target = [...els].reverse().find((x) => (x.type === 'text' || x.type === 'note') && hit(x, p.x, p.y, 4));
    if (target) {
      setSelected(new Set([target.id]));
      setEditing(target.id);
    }
  }

  async function addImage(file: File) {
    try {
      const src = await imageFileToDataUrl(file, 1600);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const r = svg.current?.getBoundingClientRect();
      const k = Math.min(1, 420 / Math.max(img.width, img.height)) / view.zoom;
      const w = img.width * k;
      const h = img.height * k;
      const cx = ((r?.width ?? 800) / 2 - view.x) / view.zoom;
      const cy = ((r?.height ?? 600) / 2 - view.y) / view.zoom;
      const id = uid();
      commit(els);
      setEls((all) => [...all, { id, type: 'image', color: '#000', width: 1, x: cx - w / 2, y: cy - h / 2, w, h, src }]);
      setTool('select');
      setSelected(new Set([id]));
    } catch {
      toast.error('This image could not be added.');
    }
  }

  async function exportAs(kind: 'png' | 'svg' | 'pdf') {
    const target = selected.size ? els.filter((x) => selected.has(x.id)) : els;
    const out = boardSvg(target);
    if (!out) {
      toast.info('The board is empty.');
      return;
    }
    const font = target.some((x) => x.type === 'text' || x.type === 'note') ? await fontCss() : '';
    const svgText = out.svg.replace('<defs>', `${font}<defs>`);
    if (kind === 'svg') {
      downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), 'whiteboard.svg');
      return;
    }
    const scale = Math.min(3, 8000 / Math.max(out.w, out.h));
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });
    const c = document.createElement('canvas');
    c.width = Math.round(out.w * scale);
    c.height = Math.round(out.h * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
    if (kind === 'png') {
      downloadBlob(png, 'whiteboard.png');
      return;
    }
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.setTitle('Whiteboard');
    pdf.setProducer('Metamorpher');
    const embedded = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
    const w = out.w * 0.75;
    const h = out.h * 0.75;
    pdf.addPage([w, h]).drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    downloadBlob(new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }), 'whiteboard.pdf');
  }

  function fit() {
    const b = unionBounds(els);
    const r = svg.current?.getBoundingClientRect();
    if (!b || !r) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const zoom = Math.min(4, Math.max(0.1, Math.min((r.width - 80) / b.w, (r.height - 80) / b.h)));
    setView({ zoom, x: r.width / 2 - (b.x + b.w / 2) * zoom, y: r.height / 2 - (b.y + b.h / 2) * zoom });
  }

  const editingEl = editing ? (els.find((x) => x.id === editing) as Box | undefined) : undefined;
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    const t = requestAnimationFrame(() => editor.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [editing]);
  const cursor = spaceDown || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const strokeTool = tool === 'pen' || tool === 'highlighter';

  return (
    <div className="flex flex-col gap-2" data-whiteboard>
      <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1.5" role="toolbar" aria-label="Whiteboard tools">
        {TOOLS.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="icon"
            variant={tool === t.id ? 'secondary' : 'ghost'}
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={t.label}
            data-tool={t.id}
            onClick={() => setTool(t.id)}
            className={cn(tool === t.id && 'ring-1 ring-primary')}
          >
            <HugeiconsIcon icon={t.icon} strokeWidth={2} />
          </Button>
        ))}
        <Button type="button" size="icon" variant="ghost" aria-label="Add image" title="Add image" onClick={() => imageInput.current?.click()}>
          <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
        </Button>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Image to add"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void addImage(f);
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" />
        {(tool === 'highlighter' ? HIGHLIGHT : COLORS).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={(tool === 'highlighter' ? hiColor : color) === c}
            onClick={() => (tool === 'highlighter' ? setHiColor(c) : setColor(c))}
            className={cn('size-5 rounded-full border-2', (tool === 'highlighter' ? hiColor : color) === c ? 'border-foreground' : 'border-transparent')}
            style={{ backgroundColor: c }}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            aria-label={`Thickness ${w}`}
            aria-pressed={width === w}
            onClick={() => setWidth(w)}
            className={cn('grid size-7 place-items-center rounded-md', width === w ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted')}
          >
            <span className="rounded-full bg-foreground" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button type="button" size="icon" variant="ghost" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={!hist.undo} onClick={undo}>
          <HugeiconsIcon icon={UndoIcon} strokeWidth={2} />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={!hist.redo} onClick={redo}>
          <HugeiconsIcon icon={RedoIcon} strokeWidth={2} />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Delete selection" title="Delete selection" disabled={!selected.size} onClick={deleteSelected}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => zoomAt((svg.current?.clientWidth ?? 0) / 2, (svg.current?.clientHeight ?? 0) / 2, 1 / 1.25)} aria-label="Zoom out">
            −
          </Button>
          <button type="button" className="min-w-12 font-mono text-[0.7rem] text-muted-foreground" onClick={fit} title="Fit the drawing" data-zoom>
            {Math.round(view.zoom * 100)}%
          </button>
          <Button type="button" size="sm" variant="ghost" onClick={() => zoomAt((svg.current?.clientWidth ?? 0) / 2, (svg.current?.clientHeight ?? 0) / 2, 1.25)} aria-label="Zoom in">
            +
          </Button>
          {(['png', 'svg', 'pdf'] as const).map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => void exportAs(k)} title={selected.size ? 'Export the selection' : 'Export the whole board'}>
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
              {k.toUpperCase()}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!els.length || !window.confirm('Clear the whole board? This also removes the copy saved in this browser.')) return;
              commit(els);
              setEls([]);
              setSelected(new Set());
              void clearBoard();
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="relative h-[calc(100dvh-15rem)] min-h-[26rem] overflow-hidden rounded-xl border bg-white" style={{ backgroundImage: 'radial-gradient(#d4d7de 1px, transparent 1px)', backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <svg
          ref={svg}
          className="absolute inset-0 size-full touch-none select-none"
          style={{ cursor }}
          role="img"
          aria-label="Whiteboard canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g dangerouslySetInnerHTML={{ __html: DEFS }} />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            {els.map((el) => (el.id === editing ? null : <ElementView key={el.id} el={el} />))}
            {selectionBox && tool === 'select' ? (
              <g pointerEvents="none">
                <rect x={selectionBox.x} y={selectionBox.y} width={selectionBox.w} height={selectionBox.h} fill="none" stroke="#1f6feb" strokeWidth={1 / view.zoom} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} />
                {[
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                ].map(([cx, cy]) => (
                  <rect
                    key={`${cx}${cy}`}
                    x={selectionBox.x + (cx as number) * selectionBox.w - 5 / view.zoom}
                    y={selectionBox.y + (cy as number) * selectionBox.h - 5 / view.zoom}
                    width={10 / view.zoom}
                    height={10 / view.zoom}
                    fill="#fff"
                    stroke="#1f6feb"
                    strokeWidth={1.5 / view.zoom}
                  />
                ))}
              </g>
            ) : null}
            {marquee ? <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(31,111,235,0.08)" stroke="#1f6feb" strokeWidth={1 / view.zoom} /> : null}
          </g>
        </svg>
        {editingEl ? (
          <textarea
            ref={editor}
            autoFocus
            aria-label={editingEl.type === 'note' ? 'Sticky note text' : 'Text'}
            defaultValue={editingEl.text ?? ''}
            className="absolute resize-none border-0 bg-transparent p-0 outline-2 outline-primary"
            style={{
              left: view.x + editingEl.x * view.zoom,
              top: view.y + editingEl.y * view.zoom,
              width: Math.max(160, editingEl.w) * view.zoom,
              height: Math.max(40, editingEl.h) * view.zoom,
              padding: editingEl.type === 'note' ? 12 * view.zoom : 0,
              background: editingEl.type === 'note' ? editingEl.fill : 'transparent',
              color: editingEl.color,
              fontFamily: '"mm-hand-caveat", cursive',
              fontSize: (editingEl.type === 'note' ? 20 : Math.max(12, editingEl.width * 6)) * view.zoom,
              lineHeight: 1.2,
            }}
            onBlur={(e) => {
              const text = e.currentTarget.value;
              const lines = text.split('\n');
              const size = editingEl.type === 'note' ? 20 : Math.max(12, editingEl.width * 6);
              setEls((all) =>
                text.trim()
                  ? all.map((x) =>
                      x.id === editingEl.id
                        ? {
                            ...(x as Box),
                            text,
                            w: editingEl.type === 'note' ? (x as Box).w : Math.max(40, Math.max(...lines.map((l) => l.length)) * size * 0.5),
                            h: editingEl.type === 'note' ? Math.max((x as Box).h, lines.length * size * 1.2 + 24) : lines.length * size * 1.2 + 6,
                          }
                        : x,
                    )
                  : all.filter((x) => x.id !== editingEl.id),
              );
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
          />
        ) : null}
        {!els.length && loaded ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-neutral-400">
            {strokeTool ? 'Draw here with a mouse, pen or finger.' : 'Click to add.'} Scroll to pan, Ctrl + scroll or pinch to zoom.
          </p>
        ) : null}
      </div>
      <p className="text-[0.7rem]/relaxed text-muted-foreground">
        Saved automatically in this browser (IndexedDB), including pasted images. Clear removes it. Exports cover the selection, or the whole board.
      </p>
    </div>
  );
}
