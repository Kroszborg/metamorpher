'use client';

import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { OptionField, OptionSelect } from '@/components/workbench';
import {
  defaultPageSize,
  MARGINS,
  type MarginPreset,
  type Orientation,
  PAGE_SIZES,
  type PageGeometry,
  pageGeometry,
  type PageSizeId,
} from '@/engines/typeset';

export type TextSize = 'small' | 'medium' | 'large';

export type PageSetup = {
  size: PageSizeId;
  orientation: Orientation | 'auto';
  margin: MarginPreset;
  textSize: TextSize;
  pageNumbers: boolean;
  outline: boolean;
};

export function defaultPageSetup(overrides: Partial<PageSetup> = {}): PageSetup {
  return {
    size: defaultPageSize(),
    orientation: 'portrait',
    margin: 'normal',
    textSize: 'medium',
    pageNumbers: true,
    outline: true,
    ...overrides,
  };
}

/** Geometry for the engine; 'auto' starts portrait (the engine turns pages for wide tables). */
export function geometryOf(setup: PageSetup): PageGeometry {
  return pageGeometry(setup.size, setup.orientation === 'landscape' ? 'landscape' : 'portrait', setup.margin);
}

const SIZE_OPTIONS = (Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => {
  const s = PAGE_SIZES[id];
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const inch = (pt: number) => +(pt / 72).toFixed(2);
  const dims = id === 'letter' || id === 'legal' || id === 'tabloid' ? `${inch(s.width)} × ${inch(s.height)} in` : `${mm(s.width)} × ${mm(s.height)} mm`;
  return { value: id, label: `${s.label} (${dims})` };
});

/** Page size, orientation, margins, text size, page numbers and bookmarks. */
export function PageSetupFields({
  id,
  value,
  onChange,
  allowAuto = false,
  showOutline = true,
  showPage = true,
  showTextSize = true,
  textSizeHint,
}: {
  /** Page size, orientation and margins (hidden when the document brings its own). */
  showPage?: boolean;
  showTextSize?: boolean;
  id: string;
  value: PageSetup;
  onChange: (next: PageSetup) => void;
  /** Offer "Auto" orientation (landscape when a table is too wide). */
  allowAuto?: boolean;
  showOutline?: boolean;
  textSizeHint?: string;
}) {
  const set = <K extends keyof PageSetup>(key: K, v: PageSetup[K]) => onChange({ ...value, [key]: v });
  const orientations: { value: PageSetup['orientation']; label: string }[] = [
    ...(allowAuto ? [{ value: 'auto' as const, label: 'Auto' }] : []),
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ];
  return (
    <>
      {showPage ? (
        <>
          <OptionField label="Page size" htmlFor={`${id}-size`}>
            <OptionSelect id={`${id}-size`} value={value.size} options={SIZE_OPTIONS} onChange={(v) => set('size', v)} />
          </OptionField>
          <OptionField
            label="Orientation"
            hint={value.orientation === 'auto' ? 'Landscape when a table is too wide for a portrait page.' : undefined}
          >
            <Segmented label="Orientation" value={value.orientation} options={orientations} onChange={(v) => set('orientation', v)} />
          </OptionField>
          <OptionField label="Margins">
            <Segmented
              label="Margins"
              value={value.margin}
              options={(Object.keys(MARGINS) as MarginPreset[]).map((m) => ({ value: m, label: MARGINS[m].label }))}
              onChange={(v) => set('margin', v)}
            />
          </OptionField>
        </>
      ) : null}
      {showTextSize ? (
        <OptionField label="Text size" hint={textSizeHint}>
          <Segmented
            label="Text size"
            value={value.textSize}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]}
            onChange={(v) => set('textSize', v)}
          />
        </OptionField>
      ) : null}
      <SwitchRow id={`${id}-numbers`} label="Page numbers" checked={value.pageNumbers} onChange={(v) => set('pageNumbers', v)} />
      {showOutline ? (
        <SwitchRow
          id={`${id}-outline`}
          label="Bookmarks from headings"
          checked={value.outline}
          onChange={(v) => set('outline', v)}
        />
      ) : null}
    </>
  );
}
