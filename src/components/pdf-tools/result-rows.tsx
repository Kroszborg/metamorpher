'use client';

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  FileZipIcon,
  InformationCircleIcon,
  Loading03Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import type { ResultFile } from '@/components/workbench';
import { zipFiles } from '@/engines/archive';
import { downloadBlob, formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';

export type NoteKind = 'ok' | 'warn' | 'info' | 'error';
export type ResultNote = { kind: NoteKind; text: React.ReactNode };

const NOTE_ICON = {
  ok: { icon: CheckmarkCircle02Icon, className: 'text-success' },
  warn: { icon: Alert02Icon, className: 'text-warning' },
  info: { icon: InformationCircleIcon, className: 'text-muted-foreground' },
  error: { icon: Alert02Icon, className: 'text-destructive' },
} as const;

export function NoteLine({ note }: { note: ResultNote }) {
  const s = NOTE_ICON[note.kind];
  return (
    <p
      data-note={note.kind}
      className={cn('flex items-start gap-1.5 text-xs/relaxed', note.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
    >
      <HugeiconsIcon icon={s.icon} strokeWidth={2} className={cn('mt-0.5 size-3.5 shrink-0', s.className)} />
      <span className="min-w-0">{note.text}</span>
    </p>
  );
}

/**
 * Finished outputs with a line of facts and verification notes under each,
 * plus "download all". `notesFor` returns the notes of one result (usually
 * looked up by `result.sourceId`).
 */
export function ResultRows({
  results,
  notesFor,
  metaFor,
  zipName = 'metamorpher.zip',
  title = 'Results',
}: {
  results: ResultFile[];
  notesFor?: (r: ResultFile) => ResultNote[];
  metaFor?: (r: ResultFile) => string | null;
  zipName?: string;
  title?: string;
}) {
  const [zipping, setZipping] = useState(false);
  if (results.length === 0) return null;
  const total = results.reduce((sum, r) => sum + r.blob.size, 0);

  async function downloadAll() {
    setZipping(true);
    try {
      downloadBlob(await zipFiles(results.map((r) => ({ name: r.name, blob: r.blob }))), zipName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <SectionCard
      title={title}
      description={`${results.length} ${results.length === 1 ? 'file' : 'files'} · ${formatBytes(total)} · made on this device`}
      contentClassName="p-0"
      action={
        results.length > 1 ? (
          <Button size="sm" variant="outline" onClick={downloadAll} disabled={zipping}>
            <HugeiconsIcon
              icon={zipping ? Loading03Icon : FileZipIcon}
              strokeWidth={2}
              className={zipping ? 'animate-spin' : undefined}
            />
            Download all (ZIP)
          </Button>
        ) : null
      }
    >
      <ul className="divide-y">
        {results.map((r) => {
          const notes = notesFor?.(r) ?? [];
          const meta = metaFor?.(r) ?? formatBytes(r.blob.size);
          return (
            <li key={r.id} className="flex min-w-0 flex-col gap-1.5 px-5 py-2.5" data-result-row>
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={r.name}>
                    {r.name}
                  </p>
                  {meta ? <p className="font-mono text-[0.7rem] text-muted-foreground">{meta}</p> : null}
                </div>
                <Button asChild size="sm">
                  <a href={r.url} download={r.name}>
                    <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                    Download
                  </a>
                </Button>
              </div>
              {notes.map((n, i) => (
                <NoteLine key={i} note={n} />
              ))}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
