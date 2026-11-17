'use client';

import { useMemo, useState } from 'react';
import {
  ColorField,
  ImageWorkbench,
  isHexColor,
  type NameClaimer,
  type Note,
  type Reporter,
  RunNotes,
  SwitchField,
  sourceNotes,
  useRunNotes,
  withDecodeFallback,
} from '@/components/image';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile, QualitySlider } from '@/components/workbench';
import { type CanvasFormat, CAN_EMBED_ICC, FORMAT_ALPHA, FORMAT_ANIMATES } from '@/engines/image';
import { replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

/** Formats the image engine cannot write go through ffmpeg (loaded only when needed). */
type FfmpegFormat = 'tiff' | 'tga';
type Format = CanvasFormat | FfmpegFormat;
type Lossy = 'jpeg' | 'webp' | 'avif';

type Options = {
  format: Format;
  quality: Record<Lossy, number>;
  lossless: boolean;
  background: string;
  colour: 'keep' | 'srgb';
  effort: 'fast' | 'smallest';
  report?: Reporter;
  claim?: NameClaimer;
};

const LABELS: Record<Format, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  bmp: 'BMP',
  ico: 'ICO (up to 256 px)',
  gif: 'GIF',
  tiff: 'TIFF',
  tga: 'TGA',
};
const EXT: Record<Format, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
  ico: 'ico',
  gif: 'gif',
  tiff: 'tiff',
  tga: 'tga',
};
const FORMATS: Format[] = ['jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tiff', 'tga'];
const isLossy = (f: Format): f is Lossy => f === 'jpeg' || f === 'webp' || f === 'avif';
const FFMPEG_OUT: Record<FfmpegFormat, string[]> = {
  tiff: ['-compression_algo', 'lzw'],
  tga: [],
};
const isFfmpegFormat = (f: Format): f is FfmpegFormat => f in FFMPEG_OUT;

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  const { image, ffmpeg } = ctx.engines;
  const notes: Note[] = [];
  let blob: Blob;
  ctx.onProgress(0.2);
  if (isFfmpegFormat(o.format)) {
    // Normalise to PNG (orientation applied, sRGB), then let ffmpeg write the target.
    const png = await withDecodeFallback(file, ctx, (src) =>
      image.process(src, { output: { format: 'png', colour: 'srgb', animation: 'first-frame' } }, ctx.signal),
    );
    notes.push(...sourceNotes(png));
    ctx.onProgress(0.6, 'Encoding with ffmpeg');
    const format = o.format;
    blob = await ffmpeg.run({
      input: png.blob,
      inputExt: 'png',
      outputExt: EXT[format],
      args: (i, out) => ['-i', i, ...FFMPEG_OUT[format], out],
      signal: ctx.signal,
    });
  } else {
    const format = o.format;
    const r = await withDecodeFallback(file, ctx, (src) =>
      image.process(
        src,
        {
          output: {
            format,
            quality: isLossy(format) ? o.quality[format] : undefined,
            lossless: o.lossless && (format === 'webp' || format === 'avif'),
            background: o.background,
            colour: o.colour,
            effort: o.effort === 'smallest' ? 'smallest' : undefined,
          },
        },
        ctx.signal,
        (f, note) => ctx.onProgress(0.2 + 0.8 * f, note),
      ),
    );
    notes.push(...sourceNotes(r));
    if (r.flattened) {
      notes.push({ text: `${LABELS[format]} has no transparency: transparent areas were filled with ${o.background}.` });
    }
    blob = r.blob;
  }
  o.report?.({ id, name: file.name }, notes);
  const name = replaceExtension(file.name, EXT[o.format]);
  return { name: o.claim?.(name) ?? name, blob };
});

export default function ConvertImage({ tool }: ToolProps) {
  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState<Record<Lossy, number>>({ jpeg: 0.85, webp: 0.85, avif: 0.6 });
  const [lossless, setLossless] = useState(false);
  const [background, setBackground] = useState('#ffffff');
  const [colour, setColour] = useState<'keep' | 'srgb'>('keep');
  const [effort, setEffort] = useState<'fast' | 'smallest'>('fast');
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({ format, quality, lossless, background, colour, effort, report: notes.report, claim: notes.claim }),
    [format, quality, lossless, background, colour, effort, notes.report, notes.claim],
  );

  const ffmpegNeeded = isFfmpegFormat(format);
  const canLossless = format === 'webp' || format === 'avif';
  const flattens = !isFfmpegFormat(format) && !FORMAT_ALPHA[format];
  const embeds = !isFfmpegFormat(format) && CAN_EMBED_ICC[format];

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Convert"
      zipName="converted-images.zip"
      onRun={notes.clear}
      validate={() => (flattens && !isHexColor(background) ? 'Enter a background colour as #rrggbb.' : null)}
      below={<RunNotes entries={notes.entries} />}
      optionsPanel={
        <>
          <OptionField
            label="Convert to"
            htmlFor="ci-format"
            hint={
              ffmpegNeeded
                ? 'This format is written with ffmpeg, which downloads once (about 31 MB) on first use.'
                : !isFfmpegFormat(format) && FORMAT_ANIMATES[format]
                  ? 'Animated GIF, WebP and PNG files keep every frame, their timing and loop count.'
                  : 'Animated images keep only their first frame in this format. Choose GIF, WebP or PNG to keep the animation.'
            }
          >
            <OptionSelect
              id="ci-format"
              value={format}
              options={FORMATS.map((f) => ({ value: f, label: LABELS[f] }))}
              onChange={setFormat}
            />
          </OptionField>
          {format === 'png' ? (
            <OptionField
              label="Compression"
              hint={
                effort === 'fast'
                  ? 'Lossless and quick, even for very large photos.'
                  : 'A few percent smaller with oxipng, but slow on photos: minutes above about 20 megapixels.'
              }
            >
              <Segmented
                label="Compression"
                value={effort}
                options={[
                  { value: 'fast', label: 'Fast' },
                  { value: 'smallest', label: 'Smallest file' },
                ]}
                onChange={setEffort}
              />
            </OptionField>
          ) : null}
          {format === 'gif' ? (
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              GIF stores up to 256 colours per frame and only fully transparent or opaque pixels. Images with more
              colours are dithered.
            </p>
          ) : null}
          {canLossless ? (
            <SwitchField
              id="ci-lossless"
              label="Lossless"
              checked={lossless}
              onChange={setLossless}
              hint="Exact pixels; larger files. Best for graphics and screenshots."
            />
          ) : null}
          {isLossy(format) && !(canLossless && lossless) ? (
            <OptionField
              label="Quality"
              htmlFor="ci-quality"
              hint={format === 'avif' ? 'AVIF looks good at lower settings than JPG; 50–70% suits most photos.' : undefined}
            >
              <QualitySlider
                id="ci-quality"
                value={quality[format]}
                onChange={(q) => setQuality((prev) => ({ ...prev, [format]: q }))}
              />
            </OptionField>
          ) : null}
          {flattens ? (
            <OptionField
              label="Background"
              htmlFor="ci-background"
              hint={`${LABELS[format]} has no transparency; transparent areas are filled with this colour.`}
            >
              <ColorField id="ci-background" value={background} onChange={setBackground} />
            </OptionField>
          ) : null}
          {embeds ? (
            <OptionField
              label="Colour profile"
              hint={
                colour === 'keep'
                  ? 'Wide-gamut photos (Display P3, Adobe RGB) keep their profile, so colours stay as they are.'
                  : 'Everything is converted to sRGB. Colours outside sRGB are clipped.'
              }
            >
              <Segmented
                label="Colour profile"
                value={colour}
                options={[
                  { value: 'keep', label: 'Keep' },
                  { value: 'srgb', label: 'Convert to sRGB' },
                ]}
                onChange={setColour}
              />
            </OptionField>
          ) : null}
        </>
      }
    />
  );
}
