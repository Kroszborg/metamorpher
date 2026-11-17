'use client';

/* eslint-disable @next/next/no-img-element -- object URLs of local files, not optimisable */

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { cn } from '@/lib/utils';
import { CHECKERBOARD } from './checker';

/**
 * Before/after comparison: the original on the left of the divider, the
 * result on the right. Drag anywhere (or use the arrow keys) to move the
 * divider; "1:1" shows real pixels so compression artefacts are visible.
 */
export function CompareSlider({
  before,
  after,
  width,
  height,
  beforeLabel = 'Original',
  afterLabel = 'Result',
  className,
}: {
  before: string;
  after: string | null;
  /** Displayed size of the image, for the aspect ratio and 1:1 zoom. */
  width: number;
  height: number;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}) {
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const box: React.CSSProperties =
    zoom === 'actual'
      ? { width, height }
      : { aspectRatio: `${width} / ${height}`, width: '100%', maxWidth: `calc(min(60vh, 560px) * ${aspect})` };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="max-h-[min(60vh,560px)] overflow-auto rounded-lg border" style={CHECKERBOARD}>
        <div className="relative mx-auto select-none" style={box}>
          <img src={before} alt={beforeLabel} draggable={false} className="absolute inset-0 size-full object-contain" />
          {after ? (
            <img
              src={after}
              alt={afterLabel}
              draggable={false}
              className="absolute inset-0 size-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            />
          ) : null}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
            style={{ left: `${pos}%` }}
          >
            <span className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background text-[0.6rem] font-semibold text-foreground shadow">
              ⇆
            </span>
          </div>
          <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
            {beforeLabel}
          </span>
          {after ? (
            <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
              {afterLabel}
            </span>
          ) : null}
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label={`Divider between ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()}`}
            className="absolute inset-0 m-0 size-full cursor-ew-resize opacity-0"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] text-muted-foreground">Drag across the image to compare.</p>
        <Segmented
          label="Zoom"
          value={zoom}
          options={[
            { value: 'fit', label: 'Fit' },
            { value: 'actual', label: '1:1' },
          ]}
          onChange={setZoom}
        />
      </div>
    </div>
  );
}
