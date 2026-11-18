'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Segmented } from '@/components/kit/segmented';
import { InfoRows, Toolbar, ViewerLoading, ViewerProblem } from '../bits';
import type { ViewerProps } from '../context';
import { useVirtualScroll } from '../virtual';
import { type FontInfo, readFont } from './sfnt';

type Tab = 'specimen' | 'glyphs' | 'info';
const CELL = 64;
const PANGRAM = 'The quick brown fox jumps over the lazy dog';
const SIZES = [12, 16, 20, 28, 36, 48, 64, 88];
/** For fonts whose character map cannot be read here (WOFF2): Latin, digits and punctuation. */
const FALLBACK = Array.from({ length: 95 }, (_, i) => i + 32).concat(Array.from({ length: 96 }, (_, i) => i + 0xa0));

let counter = 0;

export default function FontViewer({ file, sniff }: ViewerProps) {
  const [family, setFamily] = useState<string | null>(null);
  const [info, setInfo] = useState<FontInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('specimen');
  const [text, setText] = useState(PANGRAM);
  const [size, setSize] = useState(48);
  const [picked, setPicked] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let face: FontFace | null = null;
    (async () => {
      const buf = await file.arrayBuffer();
      const name = `mm-view-font-${++counter}`;
      face = new FontFace(name, buf);
      await face.load();
      if (!live) return;
      document.fonts.add(face);
      setFamily(name);
      const parsed = await readFont(buf).catch(() => null);
      if (live) setInfo(parsed);
    })().catch(() => live && setError('The browser could not load this font. It may be damaged, or a format it does not support.'));
    return () => {
      live = false;
      if (face) document.fonts.delete(face);
    };
  }, [file]);

  const codepoints = useMemo(() => (info?.codepoints.length ? info.codepoints : FALLBACK), [info]);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  const cols = Math.max(4, Math.floor(width / CELL));
  const rows = Math.ceil(codepoints.length / cols);
  const vs = useVirtualScroll(scroller, rows * CELL);

  if (error) return <ViewerProblem title="This font could not be shown">{error}</ViewerProblem>;
  if (!family || info === undefined) return <ViewerLoading label="Loading the font…" />;
  const ff = { fontFamily: `"${family}", system-ui` };
  const n = info?.names ?? {};

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'specimen', label: 'Specimen' },
            { value: 'glyphs', label: `Characters (${codepoints.length.toLocaleString()})` },
            { value: 'info', label: 'Details' },
          ]}
        />
        {tab === 'specimen' ? (
          <>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Sample text"
              placeholder="Type to preview"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:max-w-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="max-sm:sr-only">Size</span>
              <input type="range" min={10} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Preview size" className="w-24 accent-[var(--primary)]" />
              <span className="w-10 tabular-nums">{size}px</span>
            </label>
          </>
        ) : null}
      </Toolbar>
      {tab === 'specimen' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-background p-5 sm:p-8">
          <p className="text-xs text-muted-foreground">
            {n.family ?? file.name} {n.subfamily ? `· ${n.subfamily}` : ''} · {sniff.format}
          </p>
          <p className="mt-2 break-words text-foreground" style={{ ...ff, fontSize: size, lineHeight: 1.15 }}>
            {text || PANGRAM}
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
            <p className="text-[7rem] leading-none text-foreground" style={ff}>
              Aa
            </p>
            <div className="text-2xl leading-relaxed break-all text-foreground" style={ff}>
              ABCDEFGHIJKLMNOPQRSTUVWXYZ
              <br />
              abcdefghijklmnopqrstuvwxyz
              <br />
              0123456789 !?&amp;@#%()[]{'{}'}.,;:
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-3 border-t pt-6">
            {SIZES.map((s) => (
              <div key={s} className="flex items-baseline gap-4">
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{s}</span>
                <span className="min-w-0 truncate text-foreground" style={{ ...ff, fontSize: s }}>
                  {text || PANGRAM}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'glyphs' ? (
        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-background" role="grid" aria-label="Characters in the font" tabIndex={0}>
            <div style={{ height: vs.spacer }} className="relative">
              {Array.from({ length: Math.min(rows, Math.ceil(vs.height / CELL) + 3) }, (_, k) => {
                const r = Math.max(0, Math.floor(vs.top / CELL) - 1) + k;
                if (r >= rows) return null;
                return (
                  <div key={r} role="row" className="absolute left-0 flex" style={{ top: r * CELL + vs.shift }}>
                    {codepoints.slice(r * cols, r * cols + cols).map((cp) => (
                      <button
                        key={cp}
                        type="button"
                        role="gridcell"
                        title={`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`}
                        onClick={() => setPicked(cp)}
                        className="grid shrink-0 place-items-center border-r border-b text-2xl text-foreground outline-none hover:bg-muted focus-visible:bg-primary/12 aria-selected:bg-primary/15"
                        aria-selected={picked === cp}
                        style={{ ...ff, width: CELL, height: CELL }}
                      >
                        {String.fromCodePoint(cp)}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {picked !== null ? (
            <aside className="flex shrink-0 flex-col items-center gap-2 border-l bg-card p-4 max-md:border-t max-md:border-l-0 md:w-56">
              <span className="text-[6rem] leading-none text-foreground" style={ff}>
                {String.fromCodePoint(picked)}
              </span>
              <button
                type="button"
                className="font-mono text-xs text-primary"
                onClick={() => navigator.clipboard.writeText(String.fromCodePoint(picked)).then(() => toast.success('Copied the character'), () => undefined)}
              >
                U+{picked.toString(16).toUpperCase().padStart(4, '0')} · copy
              </button>
              <span className="text-xs text-muted-foreground">Decimal {picked}</span>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {info ? (
            <div className="flex max-w-2xl flex-col gap-5">
              <InfoRows
                rows={[
                  ['Family', n.family],
                  ['Style', n.subfamily],
                  ['Full name', n.full],
                  ['PostScript name', n.postscript],
                  ['Version', n.version],
                  ['Format', info.format],
                  ['Glyphs', info.glyphs?.toLocaleString()],
                  ['Characters mapped', info.codepoints.length.toLocaleString()],
                  ['Weight', info.weight ? String(info.weight) : undefined],
                  ['Italic', info.italic ? 'Yes' : undefined],
                  ['Monospaced', info.monospace ? 'Yes' : undefined],
                  ['Variable', info.variable ? 'Yes (has variation axes)' : undefined],
                  ['Units per em', info.unitsPerEm ? String(info.unitsPerEm) : undefined],
                  ['Designer', n.designer],
                  ['Made by', n.manufacturer],
                  ['Website', n.vendorUrl],
                  ['Copyright', n.copyright],
                  ['Trademark', n.trademark],
                  ['Licence', n.license],
                  ['Licence URL', n.licenseUrl],
                  ['Description', n.description],
                  ['Tables', info.tables.join(' ')],
                ]}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              The browser shows this {sniff.format}, but its details cannot be read here: WOFF2 tables are compressed with Brotli. The character grid shows the basic Latin set.
            </p>
          )}
        </div>
      )}
      <footer className="flex flex-wrap gap-x-3 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span>{n.full ?? n.family ?? file.name}</span>
        {info?.glyphs ? <span className="tabular-nums">{info.glyphs.toLocaleString()} glyphs</span> : null}
        <span>Shown with the browser&apos;s font engine; nothing is installed.</span>
      </footer>
    </div>
  );
}
