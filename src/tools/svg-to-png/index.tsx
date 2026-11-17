'use client';

import { useMemo, useState } from 'react';
import {
  ColorField,
  ImageWorkbench,
  isHexColor,
  type NameClaimer,
  type Note,
  NumberField,
  type Reporter,
  RunNotes,
  useRunNotes,
} from '@/components/image';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { MAX_PIXELS } from '@/engines/image';
import { replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { prepareSvg, rasterise } from './render';

type SizeMode = 'scale' | 'width' | 'height';
type Options = {
  sizeMode: SizeMode;
  scale: number;
  width: number;
  height: number;
  transparent: boolean;
  background: string;
  report?: Reporter;
  claim?: NameClaimer;
};

/** Canvas sides above this fail in some browsers. */
const MAX_SIDE = 16384;

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  ctx.onProgress(0.1, 'Reading the SVG');
  const svg = prepareSvg(await file.text());
  const aspect = svg.width / svg.height;
  let w: number;
  let h: number;
  if (o.sizeMode === 'width') {
    w = o.width;
    h = o.width / aspect;
  } else if (o.sizeMode === 'height') {
    h = o.height;
    w = o.height * aspect;
  } else {
    w = svg.width * o.scale;
    h = svg.height * o.scale;
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) {
    throw new Error(
      `${w} × ${h} pixels is too large to render in the browser (at most ${MAX_SIDE} px a side and ${MAX_PIXELS / 1e6} megapixels).`,
    );
  }
  ctx.onProgress(0.3, 'Rendering');
  const pixels = await rasterise(svg, w, h, o.transparent ? null : o.background, ctx.signal);
  ctx.onProgress(0.6, 'Encoding PNG');
  const blob = await ctx.engines.image.encodePixels(pixels, { format: 'png' }, ctx.signal);
  const notes: Note[] = [{ text: `${w} × ${h} px from ${Math.round(svg.width)} × ${Math.round(svg.height)}.` }];
  if (svg.guessed) notes.push({ text: 'The SVG has no size or viewBox; it was treated as 300 × 150.', tone: 'warn' });
  if (svg.removed) {
    notes.push({
      text: `${svg.removed} external ${svg.removed === 1 ? 'reference was' : 'references were'} left out (linked images, fonts or stylesheets); nothing is fetched from the network.`,
      tone: 'warn',
    });
  }
  if (svg.html) {
    notes.push({ text: 'Embedded HTML (foreignObject) cannot be rendered here and was left out; fallback text is used.', tone: 'warn' });
  }
  o.report?.({ id, name: file.name }, notes);
  const name = replaceExtension(file.name, 'png');
  return { name: o.claim?.(name) ?? name, blob };
});

const SCALES = [
  { value: '0.5', label: '0.5× (half size)' },
  { value: '1', label: '1× (the SVG’s own size)' },
  { value: '2', label: '2× (retina)' },
  { value: '3', label: '3×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' },
];

export default function SvgToPng({ tool }: ToolProps) {
  const [sizeMode, setSizeMode] = useState<SizeMode>('scale');
  const [scale, setScale] = useState(2);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [transparent, setTransparent] = useState(true);
  const [background, setBackground] = useState('#ffffff');
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({ sizeMode, scale, width, height, transparent, background, report: notes.report, claim: notes.claim }),
    [sizeMode, scale, width, height, transparent, background, notes.report, notes.claim],
  );

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Convert to PNG"
      zipName="svg-to-png.zip"
      onRun={notes.clear}
      below={<RunNotes entries={notes.entries} />}
      validate={() => (!transparent && !isHexColor(background) ? 'Enter a background colour as #rrggbb.' : null)}
      optionsPanel={
        <>
          <OptionField label="Size">
            <Segmented
              label="Size"
              value={sizeMode}
              options={[
                { value: 'scale', label: 'Scale' },
                { value: 'width', label: 'Width' },
                { value: 'height', label: 'Height' },
              ]}
              onChange={setSizeMode}
            />
          </OptionField>
          {sizeMode === 'scale' ? (
            <OptionSelect id="svg-scale" value={String(scale)} options={SCALES} onChange={(v) => setScale(Number(v))} />
          ) : sizeMode === 'width' ? (
            <NumberField id="svg-width" label="Width (height follows the shape)" value={width} min={1} max={MAX_SIDE} onCommit={setWidth} />
          ) : (
            <NumberField id="svg-height" label="Height (width follows the shape)" value={height} min={1} max={MAX_SIDE} onCommit={setHeight} />
          )}
          <OptionField label="Background">
            <Segmented
              label="Background"
              value={transparent ? 'transparent' : 'colour'}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'colour', label: 'Colour' },
              ]}
              onChange={(v) => setTransparent(v === 'transparent')}
            />
          </OptionField>
          {!transparent ? <ColorField id="svg-bg" value={background} onChange={setBackground} /> : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Rendered as vector at the chosen size, so edges stay crisp. Scripts never run, and images, fonts or
            stylesheets linked from the SVG are left out instead of being fetched; embedded ones are kept.
          </p>
        </>
      }
    />
  );
}
