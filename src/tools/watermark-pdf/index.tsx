'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import {
  ImagePicker,
  NumberInput,
  PageRangeField,
  PositionGrid,
  PreviewWorkbench,
  RangeField,
  TextStyleFields,
} from '@/components/pdf-stage';
import { Input } from '@/components/ui/input';
import { OptionField, perFile } from '@/components/workbench';
import { type GridPosition, pageRangeError, pdfStamp, type PreviewRequest, type WatermarkSpec } from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

const POSITIONS: readonly GridPosition[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];

const job = perFile<WatermarkSpec>(async (input, spec, ctx) => {
  ctx.onProgress(0.1, 'Stamping pages');
  const blob = await pdfStamp.watermark(input.file, spec, ctx.signal);
  return { name: `${baseName(input.file.name)}-watermarked.pdf`, blob };
});

const preview = (spec: WatermarkSpec): PreviewRequest | null => {
  if (spec.kind === 'text' ? !spec.text.trim() : !spec.image) return null;
  return { kind: 'watermark', spec };
};

const validate = (_files: unknown, spec: WatermarkSpec) => {
  if (spec.kind === 'text' && !spec.text.trim()) return 'Enter the watermark text.';
  if (spec.kind === 'image' && !spec.image) return 'Choose an image for the watermark.';
  const range = pageRangeError(spec.pages);
  return range ? `Pages: ${range}` : null;
};

export default function WatermarkPdf({ tool }: ToolProps) {
  const [spec, setSpec] = useState<WatermarkSpec>({
    kind: 'text',
    text: 'CONFIDENTIAL',
    style: { font: 'helvetica', bold: true, size: 60, color: '#d32f2f' },
    image: null,
    imageScale: 0.4,
    opacity: 0.3,
    rotation: 45,
    position: 'mc',
    tile: false,
    gap: 60,
    margin: 36,
    layer: 'over',
    pages: '',
  });
  const set = <K extends keyof WatermarkSpec>(key: K, value: WatermarkSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));

  return (
    <PreviewWorkbench
      job={job}
      options={spec}
      accept={tool.accept}
      runLabel="Add watermark"
      preview={preview}
      validate={validate}
      zipName="watermarked.zip"
      optionsPanel={
        <>
          <OptionField label="Watermark">
            <Segmented
              label="Watermark"
              value={spec.kind}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'image', label: 'Image' },
              ]}
              onChange={(v) => set('kind', v)}
            />
          </OptionField>
          {spec.kind === 'text' ? (
            <>
              <OptionField label="Text" htmlFor="wm-text">
                <Input id="wm-text" value={spec.text} maxLength={200} onChange={(e) => set('text', e.currentTarget.value)} />
              </OptionField>
              <TextStyleFields id="wm" value={spec.style} maxSize={300} onChange={(v) => set('style', v)} />
            </>
          ) : (
            <>
              <OptionField label="Image" htmlFor="wm-image" hint="PNG transparency is kept.">
                <ImagePicker id="wm-image" value={spec.image} onChange={(f) => set('image', f)} />
              </OptionField>
              <OptionField label="Width" htmlFor="wm-scale" hint="Share of the page width.">
                <RangeField
                  id="wm-scale"
                  min={5}
                  max={100}
                  value={Math.round(spec.imageScale * 100)}
                  onChange={(v) => set('imageScale', v / 100)}
                  format={(v) => `${v}%`}
                />
              </OptionField>
            </>
          )}
          <OptionField label="Opacity" htmlFor="wm-opacity">
            <RangeField
              id="wm-opacity"
              min={5}
              max={100}
              value={Math.round(spec.opacity * 100)}
              onChange={(v) => set('opacity', v / 100)}
              format={(v) => `${v}%`}
            />
          </OptionField>
          <OptionField label="Rotation" htmlFor="wm-rotation">
            <RangeField
              id="wm-rotation"
              min={-180}
              max={180}
              step={5}
              value={spec.rotation}
              onChange={(v) => set('rotation', v)}
              format={(v) => `${v}°`}
            />
          </OptionField>
          <OptionField label="Layout">
            <Segmented
              label="Layout"
              value={spec.tile ? 'tile' : 'single'}
              options={[
                { value: 'single', label: 'Once' },
                { value: 'tile', label: 'Tiled' },
              ]}
              onChange={(v) => set('tile', v === 'tile')}
            />
          </OptionField>
          {spec.tile ? (
            <OptionField label="Gap between tiles" htmlFor="wm-gap">
              <NumberInput id="wm-gap" value={spec.gap} min={0} max={500} integer suffix="pt" onChange={(v) => set('gap', v)} />
            </OptionField>
          ) : (
            <div className="grid grid-cols-[auto_1fr] items-start gap-3">
              <OptionField label="Position">
                <PositionGrid label="Position" value={spec.position} positions={POSITIONS} onChange={(v) => set('position', v)} />
              </OptionField>
              <OptionField label="Margin" htmlFor="wm-margin">
                <NumberInput id="wm-margin" value={spec.margin} min={0} max={300} integer suffix="pt" onChange={(v) => set('margin', v)} />
              </OptionField>
            </div>
          )}
          <OptionField
            label="Layer"
            hint={
              spec.layer === 'under'
                ? 'Drawn before the page content, so text stays on top. Hidden on pages with an opaque background, such as scans.'
                : undefined
            }
          >
            <Segmented
              label="Layer"
              value={spec.layer}
              options={[
                { value: 'over', label: 'Over content' },
                { value: 'under', label: 'Behind content' },
              ]}
              onChange={(v) => set('layer', v)}
            />
          </OptionField>
          <PageRangeField id="wm-pages" value={spec.pages} onChange={(v) => set('pages', v)} />
        </>
      }
    />
  );
}
