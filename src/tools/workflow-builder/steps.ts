/**
 * Pipeline steps: small, headless jobs on the shared engines (the same calls
 * the single-purpose tools make), each with a plain, JSON-safe options
 * object. A step declares what it takes and makes, so the builder only
 * offers steps that fit after the previous one.
 *
 * Adding a step: write a `PipelineStep` here (a `Job` from the workbench API
 * plus defaults and a summary) and describe its fields in `fields`. Secret
 * fields (passwords) are never written to saved workflows.
 */
import type { InputFile, Job, JobContext, OutputFile } from '@/components/workbench';
import type { ImagePageLayout } from '@/engines/pdf';
import type { CanvasFormat } from '@/engines/image/types';
import { COMPRESS_PRESETS, type CompressPreset } from '@/engines/mupdf';
import { pdfStamp, type TextStampSpec, type WatermarkSpec } from '@/engines/pdf-stamp';
import { baseName, extensionOf, mimeFor } from '@/lib/files';

/** What files are between steps; 'zip' is final (only an archive). */
export type Kind = 'pdf' | 'image' | 'any' | 'zip';

export type FieldSpec =
  | { key: string; label: string; type: 'text'; secret?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'number'; min: number; max: number; step?: number; suffix?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] };

export type Options = Record<string, string | number>;

export type PipelineStep = {
  id: string;
  title: string;
  description: string;
  input: Kind;
  output: Kind;
  defaults: Options;
  fields: FieldSpec[];
  summary: (o: Options) => string;
  /** Returns a message when the options cannot work. */
  check?: (o: Options) => string | null;
  job: Job<Options>;
};

const isPdf = (f: File) => extensionOf(f.name) === 'pdf' || f.type === 'application/pdf';
const isImage = (f: File) => f.type.startsWith('image/') || /^(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/.test(extensionOf(f.name));

/** Runs `fn` on each input in turn, with progress shared out. */
function eachFile(fn: (input: InputFile, o: Options, ctx: JobContext) => Promise<OutputFile>): Job<Options>['run'] {
  return async (inputs, o, ctx) => {
    const out: OutputFile[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i] as InputFile;
      const sub: JobContext = { ...ctx, onProgress: (f, note) => ctx.onProgress((i + Math.min(1, f)) / inputs.length, note) };
      out.push({ ...(await fn(input, o, sub)), sourceId: input.id });
    }
    return out;
  };
}

function needPdf(input: InputFile, step: string) {
  if (!isPdf(input.file)) throw new Error(`${step} needs PDF files; ${input.file.name} is not one.`);
}

const textStyle = (o: Options) => ({ font: 'helvetica' as const, bold: true, size: Number(o.size) || 48, color: String(o.color || '#c62828') });

export const STEPS: readonly PipelineStep[] = [
  {
    id: 'images-to-pdf',
    title: 'Images to PDF',
    description: 'All images into one PDF, one per page, in list order.',
    input: 'image',
    output: 'pdf',
    defaults: { pageSize: 'a4', margin: 18 },
    fields: [
      { key: 'pageSize', label: 'Page size', type: 'select', options: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit to image' }] },
      { key: 'margin', label: 'Margin', type: 'number', min: 0, max: 72, suffix: 'pt' },
    ],
    summary: (o) => `${String(o.pageSize).toUpperCase()} pages`,
    job: {
      mode: 'batch',
      async run(inputs, o, ctx) {
        const bad = inputs.find((i) => !isImage(i.file));
        if (bad) throw new Error(`Images to PDF needs images; ${bad.file.name} is not one.`);
        const layout = { pageSize: o.pageSize, orientation: 'auto', margin: Number(o.margin) } as ImagePageLayout;
        const blob = await ctx.engines.pdf.imagesToPdf(
          inputs.map((i) => ({ name: i.file.name, blob: i.file })),
          layout,
          { signal: ctx.signal, onProgress: (d, t) => ctx.onProgress(d / t, `Image ${d} of ${t}`) },
        );
        return [{ name: inputs.length === 1 ? `${baseName((inputs[0] as InputFile).file.name)}.pdf` : 'images.pdf', blob }];
      },
    },
  },
  {
    id: 'merge',
    title: 'Merge PDFs',
    description: 'Join every PDF into one, in list order.',
    input: 'pdf',
    output: 'pdf',
    defaults: { name: 'merged' },
    fields: [{ key: 'name', label: 'File name', type: 'text' }],
    summary: (o) => `into ${o.name || 'merged'}.pdf`,
    job: {
      mode: 'batch',
      async run(inputs, o, ctx) {
        inputs.forEach((i) => needPdf(i, 'Merge'));
        if (inputs.length === 1) return [{ name: (inputs[0] as InputFile).file.name, blob: (inputs[0] as InputFile).file }];
        const blob = await ctx.engines.pdf.merge(inputs.map((i) => ({ name: i.file.name, blob: i.file })), { signal: ctx.signal, onProgress: (d, t) => ctx.onProgress(d / t) });
        return [{ name: `${String(o.name || 'merged').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`, blob }];
      },
    },
  },
  {
    id: 'rotate',
    title: 'Rotate pages',
    description: 'Turn every page clockwise.',
    input: 'pdf',
    output: 'pdf',
    defaults: { degrees: 90 },
    fields: [{ key: 'degrees', label: 'Turn', type: 'select', options: [{ value: '90', label: '90° right' }, { value: '180', label: '180°' }, { value: '270', label: '90° left' }] }],
    summary: (o) => `${o.degrees}°`,
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        needPdf(input, 'Rotate');
        const named = { name: input.file.name, blob: input.file };
        const info = await ctx.engines.pdf.pages.inspect(named, { signal: ctx.signal });
        const blob = await ctx.engines.pdf.pages.rewrite(named, Array.from({ length: info.pageCount }, (_, page) => ({ page, rotate: Number(o.degrees) })), { signal: ctx.signal });
        return { name: input.file.name, blob };
      }),
    },
  },
  {
    id: 'page-numbers',
    title: 'Page numbers',
    description: 'Number the pages at the bottom.',
    input: 'pdf',
    output: 'pdf',
    defaults: { format: 'Page {page} of {total}', position: 'bc' },
    fields: [
      { key: 'format', label: 'Text', type: 'text', placeholder: 'Page {page} of {total}' },
      { key: 'position', label: 'Position', type: 'select', options: [{ value: 'bl', label: 'Bottom left' }, { value: 'bc', label: 'Bottom centre' }, { value: 'br', label: 'Bottom right' }, { value: 'tr', label: 'Top right' }] },
    ],
    summary: (o) => String(o.format),
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        needPdf(input, 'Page numbers');
        const spec: TextStampSpec = {
          font: 'helvetica',
          bold: false,
          size: 10,
          color: '#333333',
          slots: { [String(o.position)]: String(o.format || '{page}') },
          marginX: 36,
          marginY: 24,
          pages: '',
          skipFirst: 0,
          counting: 'document',
          startNumber: 1,
          numberStyle: 'arabic',
          date: new Date().toLocaleDateString(),
          filename: input.file.name,
        };
        ctx.onProgress(0.2, 'Numbering pages');
        const { blob } = await pdfStamp.stampText(input.file, spec, ctx.signal);
        return { name: input.file.name, blob };
      }),
    },
  },
  {
    id: 'watermark',
    title: 'Watermark',
    description: 'Stamp text across every page.',
    input: 'pdf',
    output: 'pdf',
    defaults: { text: 'CONFIDENTIAL', opacity: 0.18, size: 54, color: '#c62828', rotation: 45 },
    fields: [
      { key: 'text', label: 'Text', type: 'text' },
      { key: 'size', label: 'Size', type: 'number', min: 8, max: 200, suffix: 'pt' },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0.05, max: 1, step: 0.05 },
      { key: 'rotation', label: 'Angle', type: 'number', min: -90, max: 90, suffix: '°' },
    ],
    summary: (o) => `“${o.text}”`,
    check: (o) => (String(o.text).trim() ? null : 'Watermark: enter the text.'),
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        needPdf(input, 'Watermark');
        const spec: WatermarkSpec = {
          kind: 'text',
          text: String(o.text),
          style: textStyle(o),
          image: null,
          imageScale: 0.4,
          opacity: Number(o.opacity),
          rotation: Number(o.rotation),
          position: 'mc',
          tile: false,
          gap: 120,
          margin: 36,
          layer: 'over',
          pages: '',
        };
        ctx.onProgress(0.2, 'Stamping pages');
        return { name: input.file.name, blob: await pdfStamp.watermark(input.file, spec, ctx.signal) };
      }),
    },
  },
  {
    id: 'compress',
    title: 'Compress PDF',
    description: 'Recompress images and clean the structure (keeps the original when that is smaller).',
    input: 'pdf',
    output: 'pdf',
    defaults: { preset: 'balanced' },
    fields: [{ key: 'preset', label: 'Strength', type: 'select', options: [{ value: 'light', label: 'Light (220 dpi)' }, { value: 'balanced', label: 'Balanced (150 dpi)' }, { value: 'strong', label: 'Strong (96 dpi)' }] }],
    summary: (o) => String(o.preset),
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        needPdf(input, 'Compress');
        const preset = (String(o.preset) in COMPRESS_PRESETS ? o.preset : 'balanced') as CompressPreset;
        const { blob } = await ctx.engines.mupdf.compress(input.file, COMPRESS_PRESETS[preset], { signal: ctx.signal, onProgress: (d, t) => ctx.onProgress(t ? d / t : d) });
        return { name: input.file.name, blob: blob ?? input.file };
      }),
    },
  },
  {
    id: 'encrypt',
    title: 'Password-protect',
    description: 'AES-256 encryption; the password is needed to open the file.',
    input: 'pdf',
    output: 'pdf',
    defaults: { password: '' },
    fields: [{ key: 'password', label: 'Password (not saved)', type: 'text', secret: true }],
    summary: (o) => (o.password ? 'AES-256, password set' : 'needs a password'),
    check: (o) => (String(o.password).length >= 4 ? null : 'Password-protect: enter a password of at least 4 characters.'),
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        needPdf(input, 'Password-protect');
        ctx.onProgress(0.3, 'Encrypting');
        const pw = String(o.password);
        const blob = await ctx.engines.qpdf.encrypt(
          input.file,
          {
            userPassword: pw,
            ownerPassword: pw,
            algorithm: 'aes-256',
            permissions: { print: true, printHighQuality: true, copy: true, edit: true, annotate: true, fillForms: true, accessibility: true, assemble: true },
          },
          { signal: ctx.signal },
        );
        return { name: `${baseName(input.file.name)}-protected.pdf`, blob };
      }),
    },
  },
  {
    id: 'resize-image',
    title: 'Resize images',
    description: 'Fit the longest side to a size (never enlarges).',
    input: 'image',
    output: 'image',
    defaults: { longest: 1600 },
    fields: [{ key: 'longest', label: 'Longest side', type: 'number', min: 16, max: 10000, suffix: 'px' }],
    summary: (o) => `≤ ${o.longest}px`,
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        if (!isImage(input.file)) throw new Error(`Resize needs images; ${input.file.name} is not one.`);
        const { width, height } = await ctx.engines.image.dimensions(input.file, ctx.signal);
        const k = Math.min(1, Number(o.longest) / Math.max(width, height));
        const ext = extensionOf(input.file.name);
        const format: CanvasFormat = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
        const res = await ctx.engines.image.process(
          input.file,
          { resize: { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), fit: 'stretch' }, output: { format, quality: 0.86 } },
          ctx.signal,
          (f) => ctx.onProgress(f),
        );
        return { name: `${baseName(input.file.name)}.${format === 'jpeg' ? 'jpg' : format}`, blob: res.blob };
      }),
    },
  },
  {
    id: 'convert-image',
    title: 'Convert images',
    description: 'Change the image format.',
    input: 'image',
    output: 'image',
    defaults: { format: 'webp', quality: 0.82 },
    fields: [
      { key: 'format', label: 'Format', type: 'select', options: [{ value: 'webp', label: 'WebP' }, { value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'avif', label: 'AVIF' }] },
      { key: 'quality', label: 'Quality', type: 'number', min: 0.1, max: 1, step: 0.05 },
    ],
    summary: (o) => String(o.format).toUpperCase(),
    job: {
      mode: 'each',
      run: eachFile(async (input, o, ctx) => {
        if (!isImage(input.file)) throw new Error(`Convert needs images; ${input.file.name} is not one.`);
        const format = String(o.format) as CanvasFormat;
        const blob = await ctx.engines.image.convert(input.file, { format, quality: Number(o.quality) }, ctx.signal, (f) => ctx.onProgress(f));
        const ext = format === 'jpeg' ? 'jpg' : format;
        return { name: `${baseName(input.file.name)}.${ext}`, blob: blob.type ? blob : new Blob([blob], { type: mimeFor(ext) }) };
      }),
    },
  },
  {
    id: 'zip',
    title: 'ZIP everything',
    description: 'Put every file into one ZIP archive.',
    input: 'any',
    output: 'zip',
    defaults: { name: 'files' },
    fields: [{ key: 'name', label: 'Archive name', type: 'text' }],
    summary: (o) => `${o.name || 'files'}.zip`,
    job: {
      mode: 'batch',
      async run(inputs, o, ctx) {
        const blob = await ctx.engines.archive.zip(inputs.map((i) => ({ name: i.file.name, blob: i.file })), ctx.signal);
        return [{ name: `${String(o.name || 'files').replace(/[\\/:*?"<>|]+/g, '-')}.zip`, blob }];
      },
    },
  },
];

export function stepById(id: string): PipelineStep | undefined {
  return STEPS.find((s) => s.id === id);
}

/** What the files are after a step (a step with 'any' output keeps the kind). */
export function kindAfter(input: Kind, step: PipelineStep): Kind {
  return step.output === 'any' ? input : step.output;
}

export function fits(kind: Kind, step: PipelineStep): boolean {
  if (kind === 'zip') return false;
  return step.input === 'any' || kind === 'any' || kind === step.input;
}
