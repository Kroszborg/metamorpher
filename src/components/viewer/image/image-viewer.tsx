'use client';

/* eslint-disable @next/next/no-img-element -- object URLs of local files, not optimisable */

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ChartHistogramIcon,
  CodeIcon,
  ColorPickerIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  GitCompareIcon,
  InformationCircleIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RotateClockwiseIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from '@hugeicons/core-free-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CompareSlider } from '@/components/image/compare-slider';
import { CHECKERBOARD } from '@/components/image/checker';
import { Segmented } from '@/components/kit/segmented';
import type { JobContext } from '@/components/workbench';
import type { ImageProbe, MetadataReport } from '@/engines/image';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, InfoRows, PanelTitle, Toolbar, ToolbarSep, ViewerLoading, ViewerProblem } from '../bits';
import { CodeView } from '../code/code-view';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { extOf } from '../sniff';
import { areaPath, colourFormats, dms, type Histogram, histogram } from './image-tools';

const SHORTCUTS: Shortcut[] = [
  { keys: '+  −', label: 'Zoom in or out' },
  { keys: '0', label: 'Fit to the window' },
  { keys: '1', label: 'Actual size (100%)' },
  { keys: 'R', label: 'Rotate the view' },
  { keys: 'H  V', label: 'Flip horizontally or vertically' },
  { keys: 'I', label: 'Information panel' },
  { keys: 'K', label: 'Colour picker' },
  { keys: '←  →', label: 'Previous or next image (several files)' },
  { keys: ',  .', label: 'Previous or next frame (animations)' },
  { keys: 'Space', label: 'Play or pause an animation' },
];

const NATIVE = new Set(['jpg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
const isImageName = (f: File) => /\.(jpe?g|jfif|png|gif|webp|avif|bmp|ico|svg|heic|heif|tiff?|tga)$/i.test(f.name) || f.type.startsWith('image/');

type Panel = 'info' | 'histogram' | null;
type View = { scale: number; x: number; y: number };

/** A displayable URL for the image: the file itself, or a PNG made by the image engine or ffmpeg. */
async function displayable(file: File, ext: string, signal: AbortSignal): Promise<{ blob: Blob; converted: string | null }> {
  if (NATIVE.has(ext)) return { blob: file, converted: null };
  if (ext === 'heic') {
    const { imageEngine } = await import('@/engines/image');
    return { blob: await imageEngine.convert(file, { format: 'png' }, signal), converted: 'HEIC decoded to PNG for display' };
  }
  const { engines } = await import('@/engines');
  const { ffmpegToPng } = await import('@/components/image/source');
  const ctx = { signal, onProgress: () => undefined, engines } as unknown as JobContext;
  return { blob: await ffmpegToPng(file, ext === 'tif' ? 'tiff' : ext, ctx), converted: `${ext.toUpperCase()} decoded with ffmpeg for display` };
}

/** An object URL for a blob, created and revoked by the same effect (safe under StrictMode re-runs). */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    queueMicrotask(() => setUrl({ blob, url: u }));
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url && url.blob === blob ? url.url : null;
}

/** Animated GIF/WebP/APNG frames through WebCodecs ImageDecoder, where the browser has it. */
function useFrames(file: File, mime: string, animated: boolean) {
  const [decoder, setDecoder] = useState<ImageDecoder | null>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!animated || typeof ImageDecoder === 'undefined') return;
    let live = true;
    let dec: ImageDecoder | null = null;
    (async () => {
      if (!(await ImageDecoder.isTypeSupported(mime))) return;
      dec = new ImageDecoder({ data: await file.arrayBuffer(), type: mime });
      await dec.tracks.ready;
      await dec.completed;
      if (!live) return;
      setDecoder(dec);
      setCount(dec.tracks.selectedTrack?.frameCount ?? 0);
    })().catch(() => undefined);
    return () => {
      live = false;
      dec?.close();
    };
  }, [file, mime, animated]);
  return { decoder, count };
}

export default function ImageViewer({ file, sniff, files, index, onIndex }: ViewerProps) {
  useShortcuts(SHORTCUTS);
  const ext = sniff.ext === 'jpeg' ? 'jpg' : sniff.ext === 'tiff' ? 'tif' : sniff.ext;
  const [blob, setBlob] = useState<{ blob: Blob; converted: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = useObjectUrl(blob?.blob ?? null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitMode, setFitMode] = useState(true);
  const [rot, setRot] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [checker, setChecker] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<{ x: number; y: number; r: number; g: number; b: number; a: number } | null>(null);
  const [probe, setProbe] = useState<ImageProbe | null>(null);
  const [meta, setMeta] = useState<MetadataReport | null>(null);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [compare, setCompare] = useState<{ other: number; mode: 'slider' | 'side' } | null>(null);
  const [svgSource, setSvgSource] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pixels = useRef<CanvasRenderingContext2D | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const ctrl = new AbortController();
    displayable(file, ext, ctrl.signal).then(
      (b) => setBlob(b),
      (err: unknown) => !ctrl.signal.aborted && setError(err instanceof Error ? err.message : 'This image could not be decoded.'),
    );
    if (ext === 'svg') file.text().then(setSvgSource, () => undefined);
    return () => ctrl.abort();
  }, [file, ext]);

  useEffect(() => {
    let live = true;
    import('@/engines/image').then(async ({ imageEngine }) => {
      const [p, m] = await Promise.allSettled([imageEngine.probe(file), imageEngine.readMetadata(file)]);
      if (!live) return;
      if (p.status === 'fulfilled') setProbe(p.value);
      if (m.status === 'fulfilled') setMeta(m.value);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [file]);

  const { decoder, count: frameCount } = useFrames(file, sniff.mime, !!probe?.animated);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const turned = rot % 180 !== 0;
  const fitScale = natural && box.w ? Math.min(1, Math.min((box.w - 32) / (turned ? natural.h : natural.w), (box.h - 32) / (turned ? natural.w : natural.h))) : 1;
  const scale = fitMode ? fitScale : view.scale;
  const x = fitMode ? 0 : view.x;
  const y = fitMode ? 0 : view.y;

  const zoomAt = useCallback(
    (factor: number, px = 0, py = 0) => {
      setFitMode(false);
      setView((v) => {
        const cur = fitMode ? { scale: fitScale, x: 0, y: 0 } : v;
        const s = Math.max(0.02, Math.min(64, cur.scale * factor));
        const k = s / cur.scale;
        return { scale: s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k };
      });
    },
    [fitMode, fitScale],
  );

  const actual = useCallback(() => {
    setFitMode(false);
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  // Pixels for the picker and the histogram: drawn once from the displayed image.
  const ensurePixels = useCallback((): CanvasRenderingContext2D | null => {
    if (pixels.current) return pixels.current;
    const el = img.current;
    if (!el || !natural) return null;
    const max = 50_000_000;
    const k = Math.min(1, Math.sqrt(max / (natural.w * natural.h)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(natural.w * k));
    c.height = Math.max(1, Math.round(natural.h * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas.current && decoder ? canvas.current : el, 0, 0, c.width, c.height);
    pixels.current = ctx;
    return ctx;
  }, [natural, decoder]);

  useEffect(() => {
    if (panel !== 'histogram' || !natural) return;
    const el = img.current;
    if (!el) return;
    const k = Math.min(1, 512 / Math.max(natural.w, natural.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(natural.w * k));
    c.height = Math.max(1, Math.round(natural.h * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(el, 0, 0, c.width, c.height);
    try {
      const h = histogram(ctx.getImageData(0, 0, c.width, c.height).data);
      queueMicrotask(() => setHist(h));
    } catch {
      // A tainted canvas cannot happen with local files; ignore anyway.
    }
  }, [panel, natural, url]);

  // Animation playback.
  useEffect(() => {
    if (!decoder || !frameCount) return;
    let live = true;
    let timer = 0;
    const draw = async (i: number) => {
      const { image } = await decoder.decode({ frameIndex: i });
      const c = canvas.current;
      if (!live || !c) {
        image.close();
        return 0;
      }
      c.width = image.displayWidth;
      c.height = image.displayHeight;
      c.getContext('2d')?.drawImage(image, 0, 0);
      const ms = (image.duration ?? 100_000) / 1000;
      image.close();
      return ms;
    };
    void draw(frame).then((ms) => {
      if (live && playing) timer = window.setTimeout(() => setFrame((f) => (f + 1) % frameCount), Math.max(20, ms || 100));
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [decoder, frameCount, frame, playing]);

  const images = useMemo(() => files.map((f, i) => ({ f, i })).filter(({ f }) => isImageName(f)), [files]);
  const go = useCallback(
    (dir: 1 | -1) => {
      if (images.length < 2) return;
      const at = images.findIndex((x) => x.i === index);
      onIndex(images[(at + dir + images.length) % images.length]!.i);
    },
    [images, index, onIndex],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      switch (e.key) {
        case '+':
        case '=':
          zoomAt(1.25);
          return true;
        case '-':
          zoomAt(0.8);
          return true;
        case '0':
          setFitMode(true);
          return true;
        case '1':
          actual();
          return true;
        case 'r':
        case 'R':
          setRot((r) => (r + 90) % 360);
          return true;
        case 'h':
        case 'H':
          setFlipH((v) => !v);
          return true;
        case 'v':
        case 'V':
          setFlipV((v) => !v);
          return true;
        case 'i':
        case 'I':
          setPanel((p) => (p === 'info' ? null : 'info'));
          return true;
        case 'k':
        case 'K':
          setPicker((v) => !v);
          return true;
        case 'ArrowRight':
          if (images.length < 2) return false;
          go(1);
          return true;
        case 'ArrowLeft':
          if (images.length < 2) return false;
          go(-1);
          return true;
        case ',':
          if (!frameCount) return false;
          setPlaying(false);
          setFrame((f) => (f - 1 + frameCount) % frameCount);
          return true;
        case '.':
          if (!frameCount) return false;
          setPlaying(false);
          setFrame((f) => (f + 1) % frameCount);
          return true;
        case ' ':
          if (!frameCount) return false;
          setPlaying((p) => !p);
          return true;
        default:
          return false;
      }
    },
    [zoomAt, actual, images.length, go, frameCount],
  );
  useKeys(onKey);

  // Wheel zoom around the cursor (non-passive, so the page does not scroll).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const pickAt = (clientX: number, clientY: number) => {
    const el = img.current ?? canvas.current;
    if (!el || !natural) return;
    const ctx = ensurePixels();
    if (!ctx) return;
    // Map the screen point back through rotation and flips to image pixels.
    const r = viewport.current!.getBoundingClientRect();
    let dx = (clientX - r.left - r.width / 2 - x) / scale;
    let dy = (clientY - r.top - r.height / 2 - y) / scale;
    const a = (-rot * Math.PI) / 180;
    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
    if (flipH) dx = -dx;
    if (flipV) dy = -dy;
    const ix = Math.floor(dx + natural.w / 2);
    const iy = Math.floor(dy + natural.h / 2);
    if (ix < 0 || iy < 0 || ix >= natural.w || iy >= natural.h) return;
    const k = ctx.canvas.width / natural.w;
    const d = ctx.getImageData(Math.floor(ix * k), Math.floor(iy * k), 1, 1).data;
    setPicked({ x: ix, y: iy, r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! });
  };

  if (error) {
    return (
      <ViewerProblem title="This image could not be shown">
        {error} The file may be damaged, or use a variant of {sniff.format} this browser cannot decode.
      </ViewerProblem>
    );
  }

  const transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale}) rotate(${rot}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`;
  const animated = !!decoder && frameCount > 1;
  const other = compare ? files[compare.other] : null;
  const exif = meta?.exif;
  const gps = exif?.gps;
  const colour = picked ? colourFormats(picked.r, picked.g, picked.b, picked.a) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <IconButton icon={ZoomOutAreaIcon} label="Zoom out (−)" onClick={() => zoomAt(0.8)} />
        <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
        <IconButton icon={ZoomInAreaIcon} label="Zoom in (+)" onClick={() => zoomAt(1.25)} />
        <ChipButton pressed={fitMode} onClick={() => setFitMode(true)}>
          Fit
        </ChipButton>
        <ChipButton pressed={!fitMode && view.scale === 1} onClick={actual}>
          100%
        </ChipButton>
        <ToolbarSep />
        <IconButton icon={RotateClockwiseIcon} label="Rotate the view (R)" onClick={() => setRot((r) => (r + 90) % 360)} />
        <IconButton icon={FlipHorizontalIcon} label="Flip horizontally (H)" pressed={flipH} onClick={() => setFlipH((v) => !v)} />
        <IconButton icon={FlipVerticalIcon} label="Flip vertically (V)" pressed={flipV} onClick={() => setFlipV((v) => !v)} />
        <ChipButton pressed={checker} onClick={() => setChecker((v) => !v)} title="Show transparent areas as a checkerboard">
          <span aria-hidden className="size-3.5 rounded-sm border" style={CHECKERBOARD} />
          <span className="max-md:hidden">Transparency</span>
        </ChipButton>
        <ToolbarSep />
        <IconButton icon={ColorPickerIcon} label="Colour picker (K)" pressed={picker} onClick={() => setPicker((v) => !v)} />
        <IconButton icon={InformationCircleIcon} label="Information (I)" pressed={panel === 'info'} onClick={() => setPanel((p) => (p === 'info' ? null : 'info'))} />
        <IconButton icon={ChartHistogramIcon} label="Histogram" pressed={panel === 'histogram'} onClick={() => setPanel((p) => (p === 'histogram' ? null : 'histogram'))} />
        {images.length > 1 ? (
          <IconButton
            icon={GitCompareIcon}
            label="Compare with another image"
            pressed={!!compare}
            onClick={() =>
              setCompare((c) => (c ? null : { other: images.find((m) => m.i !== index)?.i ?? index, mode: 'slider' }))
            }
          />
        ) : null}
        {svgSource !== null ? (
          <IconButton icon={CodeIcon} label="SVG source" pressed={showSource} onClick={() => setShowSource((v) => !v)} />
        ) : null}
        {animated ? (
          <>
            <ToolbarSep />
            <IconButton icon={PreviousIcon} label="Previous frame (,)" onClick={() => { setPlaying(false); setFrame((f) => (f - 1 + frameCount) % frameCount); }} />
            <IconButton icon={playing ? PauseIcon : PlayIcon} label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying((p) => !p)} />
            <IconButton icon={NextIcon} label="Next frame (.)" onClick={() => { setPlaying(false); setFrame((f) => (f + 1) % frameCount); }} />
            <span className="text-xs text-muted-foreground tabular-nums">
              Frame {frame + 1} / {frameCount}
            </span>
          </>
        ) : null}
      </Toolbar>

      <div className="relative flex min-h-0 flex-1">
        {compare && other ? (
          <CompareView a={file} b={other} mode={compare.mode} onMode={(mode) => setCompare({ ...compare, mode })} images={images} other={compare.other} onOther={(o) => setCompare({ ...compare, other: o })} current={index} />
        ) : showSource && svgSource !== null ? (
          <CodeView text={svgSource} language="xml" wrap label={`Source of ${file.name}`} />
        ) : (
          <div
            ref={viewport}
            tabIndex={0}
            aria-label={`Image ${file.name}`}
            role="img"
            className={cn('relative min-h-0 flex-1 touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset', picker ? 'cursor-crosshair' : fitMode ? 'cursor-zoom-in' : 'cursor-grab active:cursor-grabbing')}
            style={checker ? CHECKERBOARD : { background: 'var(--muted)' }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (picker) pickAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              const prev = pointers.current.get(e.pointerId);
              if (!prev) {
                if (picker && e.buttons === 0 && e.pointerType === 'mouse') pickAt(e.clientX, e.clientY);
                return;
              }
              const pts = [...pointers.current.entries()];
              if (pts.length === 2) {
                const other2 = pts.find(([id]) => id !== e.pointerId)![1];
                const before = Math.hypot(prev.x - other2.x, prev.y - other2.y);
                const after = Math.hypot(e.clientX - other2.x, e.clientY - other2.y);
                const r = viewport.current!.getBoundingClientRect();
                if (before > 0) zoomAt(after / before, (e.clientX + other2.x) / 2 - r.left - r.width / 2, (e.clientY + other2.y) / 2 - r.top - r.height / 2);
              } else if (picker) {
                pickAt(e.clientX, e.clientY);
              } else {
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                setFitMode(false);
                setView((v) => (fitMode ? { scale: fitScale, x: dx, y: dy } : { ...v, x: v.x + dx, y: v.y + dy }));
              }
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }}
            onPointerUp={(e) => pointers.current.delete(e.pointerId)}
            onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
            onDoubleClick={(e) => {
              const r = viewport.current!.getBoundingClientRect();
              if (fitMode) {
                const px = e.clientX - r.left - r.width / 2;
                const py = e.clientY - r.top - r.height / 2;
                const k = 1 / fitScale;
                setFitMode(false);
                setView({ scale: 1, x: px - px * k, y: py - py * k });
              } else setFitMode(true);
            }}
          >
            {url ? (
              <>
                <img
                  ref={img}
                  src={url}
                  alt={file.name}
                  draggable={false}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    pixels.current = null;
                    setNatural({ w: el.naturalWidth || 300, h: el.naturalHeight || 150 });
                  }}
                  onError={() => setError(`The browser could not decode this ${sniff.format}.`)}
                  className={cn('absolute top-1/2 left-1/2 max-w-none', animated && 'invisible')}
                  style={{
                    width: natural?.w,
                    height: natural?.h,
                    transform,
                    imageRendering: scale >= 3 ? 'pixelated' : 'auto',
                  }}
                />
                {animated ? (
                  <canvas
                    ref={canvas}
                    className="absolute top-1/2 left-1/2"
                    style={{ width: natural?.w, height: natural?.h, transform, imageRendering: scale >= 3 ? 'pixelated' : 'auto' }}
                  />
                ) : null}
              </>
            ) : (
              <ViewerLoading label={NATIVE.has(ext) ? 'Opening…' : `Decoding ${sniff.format}…`} />
            )}
            {picker && colour && picked ? (
              <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border bg-popover/95 p-2 text-xs shadow-lg">
                <span className="size-9 rounded-md border" style={{ background: colour.rgb }} />
                <div className="font-mono">
                  <p className="font-semibold text-foreground">{colour.hex}</p>
                  <p className="text-muted-foreground">{colour.rgb}</p>
                  <p className="text-muted-foreground">
                    {colour.hsl} · x {picked.x}, y {picked.y}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {panel ? (
          <aside data-viewer-panel aria-label={panel === 'info' ? 'Information' : 'Histogram'} className="flex flex-col border-l bg-card max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:max-h-[60%] max-lg:border-t max-lg:border-l-0 lg:w-80">
            <PanelTitle action={<ChipButton onClick={() => setPanel(null)}>Close</ChipButton>}>{panel === 'info' ? 'Information' : 'Histogram'}</PanelTitle>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {panel === 'info' ? (
                <div className="flex flex-col gap-4">
                  <InfoRows
                    rows={[
                      ['Format', sniff.format],
                      ['Size', natural ? `${natural.w.toLocaleString()} × ${natural.h.toLocaleString()} px` : probe ? `${probe.width} × ${probe.height} px` : '…'],
                      ['Megapixels', natural ? (natural.w * natural.h / 1e6).toFixed(2) : undefined],
                      ['File size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
                      ['Animation', probe?.animated ? `${probe.frames ?? frameCount} frames` : undefined],
                      ['Transparency', probe ? (probe.alpha ? 'Yes (alpha channel)' : 'No') : undefined],
                      ['Colour', probe?.cmyk ? 'CMYK' : undefined],
                      ['Colour profile', meta?.icc ?? probe?.iccDescription],
                      ['Orientation', exif?.orientation && exif.orientation !== 1 ? `EXIF ${exif.orientation} (applied)` : undefined],
                      ['Shown as', blob?.converted ?? undefined],
                    ]}
                  />
                  {exif ? (
                    <section>
                      <h4 className="mb-1.5 text-xs font-semibold">Camera (EXIF)</h4>
                      <InfoRows
                        rows={[
                          ['Camera', [exif.make, exif.model].filter(Boolean).join(' ') || undefined],
                          ['Lens', exif.lens],
                          ['Taken', exif.dateTaken],
                          ['Modified', exif.dateModified],
                          ['Software', exif.software],
                          ['Artist', exif.artist],
                          ['Copyright', exif.copyright],
                          ['Description', exif.description],
                          ['Serial number', exif.serialNumber],
                          ['Tags', String(exif.tagCount)],
                          ['Maker notes', exif.hasMakerNote ? 'Present' : undefined],
                          ['Thumbnail', exif.hasThumbnail ? 'Embedded' : undefined],
                        ]}
                      />
                    </section>
                  ) : null}
                  {gps || exif?.hasGps || meta?.xmpGps ? (
                    <section className="rounded-lg border border-warning/40 bg-warning/8 p-2.5">
                      <h4 className="mb-1.5 text-xs font-semibold">Location (GPS)</h4>
                      {gps ? (
                        <>
                          <InfoRows
                            rows={[
                              ['Latitude', `${gps.latitude.toFixed(6)} · ${dms(gps.latitude, 'N', 'S')}`],
                              ['Longitude', `${gps.longitude.toFixed(6)} · ${dms(gps.longitude, 'E', 'W')}`],
                              ['Altitude', gps.altitude !== undefined ? `${gps.altitude.toFixed(1)} m` : undefined],
                            ]}
                          />
                          <button
                            type="button"
                            className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
                            onClick={() =>
                              navigator.clipboard.writeText(`${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`).then(
                                () => toast.success('Copied the coordinates'),
                                () => undefined,
                              )
                            }
                          >
                            Copy coordinates
                          </button>
                          <p className="mt-1 text-[0.68rem] text-muted-foreground">No map is shown: that would send the location to a map server.</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">GPS tags are present but hold no usable position.</p>
                      )}
                    </section>
                  ) : null}
                  {meta && (meta.xmp || meta.iptc || meta.text.length || meta.comments.length || meta.other.length) ? (
                    <section>
                      <h4 className="mb-1.5 text-xs font-semibold">Other metadata</h4>
                      <InfoRows
                        rows={[
                          ['XMP', meta.xmp ? 'Present' : undefined],
                          ['IPTC', meta.iptc ? 'Present' : undefined],
                          ...meta.comments.map((c, i) => [`Comment ${i + 1}`, c] as [string, string]),
                          ...meta.text.map((t) => [t.key, t.value.slice(0, 300)] as [string, string]),
                          ['Also', meta.other.join(', ') || undefined],
                          ['Trailing bytes', meta.trailingBytes ? formatBytes(meta.trailingBytes) : undefined],
                        ]}
                      />
                    </section>
                  ) : null}
                </div>
              ) : hist ? (
                <div className="flex flex-col gap-3">
                  <svg viewBox="0 0 256 100" preserveAspectRatio="none" className="h-36 w-full rounded-md border bg-background" role="img" aria-label="Colour histogram">
                    <path d={areaPath(hist.l, hist.max)} fill="var(--muted-foreground)" opacity="0.25" />
                    <path d={areaPath(hist.r, hist.max)} fill="#ef4444" opacity="0.45" style={{ mixBlendMode: 'screen' }} />
                    <path d={areaPath(hist.g, hist.max)} fill="#22c55e" opacity="0.45" style={{ mixBlendMode: 'screen' }} />
                    <path d={areaPath(hist.b, hist.max)} fill="#3b82f6" opacity="0.45" style={{ mixBlendMode: 'screen' }} />
                  </svg>
                  <p className="text-xs text-muted-foreground">
                    Red, green and blue levels over {hist.pixels.toLocaleString()} sampled pixels{hist.alpha ? ' (transparent pixels left out)' : ''}. Grey is brightness.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Counting…</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {images.length > 1 && !compare ? (
        <div className="flex items-center gap-1 border-t bg-card px-2 py-1.5">
          <IconButton icon={ArrowLeft01Icon} label="Previous image (←)" onClick={() => go(-1)} />
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5" role="listbox" aria-label="Images">
            {images.map(({ f, i }) => (
              <GalleryThumb key={i} file={f} active={i === index} onPick={() => onIndex(i)} />
            ))}
          </div>
          <IconButton icon={ArrowRight01Icon} label="Next image (→)" onClick={() => go(1)} />
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">{natural ? `${natural.w.toLocaleString()} × ${natural.h.toLocaleString()} px` : '…'}</span>
        <span>{sniff.format}</span>
        {blob?.converted ? <span>{blob.converted}</span> : null}
        {gps ? <span className="text-warning">Contains a GPS location</span> : null}
        {picker ? <span>Click or hover to read a colour; click copies nothing, the values are shown bottom left.</span> : null}
        {colour && picker ? (
          <button type="button" className="text-primary" onClick={() => navigator.clipboard.writeText(colour.hex).then(() => toast.success(`Copied ${colour.hex}`), () => undefined)}>
            Copy {colour.hex}
          </button>
        ) : null}
        {images.length > 1 ? <span className="tabular-nums">Image {images.findIndex((m) => m.i === index) + 1} of {images.length}</span> : null}
      </footer>
    </div>
  );
}

function GalleryThumb({ file, active, onPick }: { file: File; active: boolean; onPick: () => void }) {
  const native = NATIVE.has(extOf(file.name).replace('jpeg', 'jpg'));
  const url = useObjectUrl(native ? file : null);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      title={file.name}
      className={cn(
        'grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-[0.6rem] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        active && 'ring-2 ring-primary',
      )}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : extOf(file.name).toUpperCase()}
    </button>
  );
}

function CompareView({
  a,
  b,
  mode,
  onMode,
  images,
  other,
  onOther,
  current,
}: {
  a: File;
  b: File;
  mode: 'slider' | 'side';
  onMode: (m: 'slider' | 'side') => void;
  images: { f: File; i: number }[];
  other: number;
  onOther: (i: number) => void;
  current: number;
}) {
  const ua = useObjectUrl(a);
  const ub = useObjectUrl(b);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!ua) return;
    const im = new Image();
    im.onload = () => setSize({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = ua;
  }, [ua]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5 text-xs">
        <Segmented label="Compare" value={mode} onChange={onMode} options={[{ value: 'slider', label: 'Slider' }, { value: 'side', label: 'Side by side' }]} />
        <label className="flex items-center gap-1.5 text-muted-foreground">
          with
          <select value={other} onChange={(e) => onOther(Number(e.target.value))} className="h-7 max-w-56 rounded-md border border-input bg-background px-1.5 text-foreground">
            {images.filter((m) => m.i !== current).map((m) => (
              <option key={m.i} value={m.i}>
                {m.f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {mode === 'slider' && ua && ub && size ? (
          <CompareSlider before={ua} after={ub} width={size.w} height={size.h} beforeLabel={a.name} afterLabel={b.name} className="mx-auto" />
        ) : (
          <div className="grid h-full grid-cols-2 gap-3 max-sm:grid-cols-1">
            {[
              { f: a, u: ua },
              { f: b, u: ub },
            ].map(({ f, u }) => (
              <figure key={f.name} className="flex min-h-0 flex-col items-center gap-1.5">
                <div className="grid min-h-0 w-full flex-1 place-items-center rounded-lg border" style={CHECKERBOARD}>
                  {u ? <img src={u} alt={f.name} className="max-h-full max-w-full object-contain" /> : null}
                </div>
                <figcaption className="truncate text-xs text-muted-foreground">{f.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
