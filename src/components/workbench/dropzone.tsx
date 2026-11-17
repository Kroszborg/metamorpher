'use client';

import { CloudUploadIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Formats people look for first, so a long list still shows them before it is cut short. */
const NOTABLE = ['PDF', 'JPG', 'PNG', 'WEBP', 'HEIC', 'AVIF', 'SVG', 'GIF', 'TIFF', 'MP4', 'MOV', 'MP3', 'DOCX'];

/** "PDF, JPG, PNG" from an accept list, for the hint line (notable formats first, at most 8). */
export function describeAccept(accept: readonly string[]): string {
  const exts = accept.filter((a) => a.startsWith('.')).map((a) => a.slice(1).toUpperCase());
  const unique = [...new Set(exts.map((e) => (e === 'JPEG' ? 'JPG' : e === 'TIF' ? 'TIFF' : e)))];
  if (unique.length === 0) return 'Any file';
  const rank = (e: string) => {
    const i = NOTABLE.indexOf(e);
    return i < 0 ? NOTABLE.length : i;
  };
  const ordered = unique.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  return ordered.length > 8 ? `${ordered.slice(0, 8).join(', ')} and more` : ordered.join(', ');
}

/**
 * Drop target, file picker and clipboard paste. Calls `onFiles` with every
 * file offered; filtering by `accept` happens in the workbench so it can say
 * what was skipped.
 */
export function Dropzone({
  accept,
  multiple = true,
  disabled = false,
  compact = false,
  onFiles,
  className,
}: {
  accept: readonly string[];
  multiple?: boolean;
  disabled?: boolean;
  /** A one-line "add more" strip instead of the large target. */
  compact?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hintId = useId();

  // Paste files from the clipboard anywhere on the page (not into text fields).
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        onFiles(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, onFiles]);

  const open = () => input.current?.click();

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-describedby={hintId}
      onClick={() => !disabled && open()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        if (!disabled) setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'group flex cursor-pointer items-center rounded-xl border border-dashed text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        compact ? 'gap-2 px-4 py-3 text-xs' : 'flex-col justify-center gap-3 px-6 py-12',
        over ? 'border-primary bg-primary/5' : 'border-input bg-background hover:bg-muted/50',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-foreground',
          compact ? 'size-7' : 'size-11',
          over && 'bg-primary/10 text-primary',
        )}
      >
        <HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} className={compact ? 'size-4' : 'size-5'} />
      </span>
      <div className={cn('min-w-0', compact && 'flex flex-1 flex-wrap items-baseline gap-x-2 text-left')}>
        <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
          {compact ? 'Add more files' : multiple ? 'Drop files here' : 'Drop a file here'}
          <span className="text-muted-foreground">
            {' '}
            or <span className="text-primary underline-offset-4 group-hover:underline">browse</span>
          </span>
        </p>
        <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">
          {describeAccept(accept)}
          {compact ? '' : ' · You can also paste'}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept.join(',')}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length) onFiles(picked);
        }}
      />
    </div>
  );
}
