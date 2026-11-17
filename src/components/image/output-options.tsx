'use client';

import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, QualitySlider } from '@/components/workbench';
import { type CanvasFormat, keepFormat, type SourceFormat } from '@/engines/image';
import { ColorField } from './color-field';

export type OutputChoice = 'keep' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';
export type OutputSettings = {
  format: OutputChoice;
  quality: number;
  background: string;
  /** PNG: fast lossless writer (default) or oxipng's smallest file. */
  effort?: 'fast' | 'smallest';
};

const CHOICES: { value: OutputChoice; label: string }[] = [
  { value: 'keep', label: 'Same as the original' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'gif', label: 'GIF' },
];

/** The format to write for a source: the chosen one, or the original's (HEIC → JPG, TIFF → PNG). */
export function resolveOutput(choice: OutputChoice, source: SourceFormat): CanvasFormat {
  if (choice !== 'keep') return choice;
  const kept = keepFormat(source);
  return kept === 'ico' ? 'png' : kept;
}

/**
 * Output format, quality and (for formats without transparency) background,
 * for tools that transform pixels and then re-encode.
 */
export function OutputOptions({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: OutputSettings;
  onChange: (next: OutputSettings) => void;
}) {
  const lossy = value.format === 'keep' || value.format === 'jpeg' || value.format === 'webp' || value.format === 'avif';
  const flattens = value.format === 'keep' || value.format === 'jpeg';
  return (
    <>
      <OptionField
        label="Save as"
        htmlFor={`${idPrefix}-format`}
        hint={
          value.format === 'keep'
            ? 'HEIC is saved as JPG and TIFF as PNG. Animated GIF, WebP and PNG files stay animated.'
            : value.format === 'jpeg' || value.format === 'avif'
              ? 'Animated images keep only their first frame in this format.'
              : undefined
        }
      >
        <OptionSelect
          id={`${idPrefix}-format`}
          value={value.format}
          options={CHOICES}
          onChange={(format) => onChange({ ...value, format })}
        />
      </OptionField>
      {lossy ? (
        <OptionField
          label="Quality"
          htmlFor={`${idPrefix}-quality`}
          hint={value.format === 'keep' ? 'Used for JPG, WebP and AVIF; PNG is always lossless.' : undefined}
        >
          <QualitySlider
            id={`${idPrefix}-quality`}
            value={value.quality}
            onChange={(quality) => onChange({ ...value, quality })}
          />
        </OptionField>
      ) : null}
      {value.format === 'png' ? (
        <OptionField
          label="PNG compression"
          hint={
            (value.effort ?? 'fast') === 'fast'
              ? 'Lossless and quick, even for very large photos.'
              : 'A few percent smaller with oxipng, but slow on photos: minutes above about 20 megapixels.'
          }
        >
          <Segmented
            label="PNG compression"
            value={value.effort ?? 'fast'}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'smallest', label: 'Smallest file' },
            ]}
            onChange={(effort) => onChange({ ...value, effort })}
          />
        </OptionField>
      ) : null}
      {flattens ? (
        <OptionField
          label="Background"
          htmlFor={`${idPrefix}-bg`}
          hint="Fills transparent areas when saving as JPG, which has no transparency."
        >
          <ColorField id={`${idPrefix}-bg`} value={value.background} onChange={(background) => onChange({ ...value, background })} />
        </OptionField>
      ) : null}
    </>
  );
}
