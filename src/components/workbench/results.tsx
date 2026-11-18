'use client';

import { Download04Icon, FileZipIcon, Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { zipFiles } from '@/engines/archive';
import { downloadBlob, formatBytes } from '@/lib/files';
import type { ResultFile } from './types';

/** Finished outputs: one link per file, plus a single ZIP for all of them. */
export function Results({ results, zipName = 'metamorpher.zip' }: { results: ResultFile[]; zipName?: string }) {
  const [zipping, setZipping] = useState(false);
  if (results.length === 0) return null;

  const total = results.reduce((sum, r) => sum + r.blob.size, 0);

  async function downloadAll() {
    setZipping(true);
    try {
      const zip = await zipFiles(results.map((r) => ({ name: r.name, blob: r.blob })));
      downloadBlob(zip, zipName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the ZIP file.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <SectionCard
      title="Results"
      description={`${results.length} ${results.length === 1 ? 'file' : 'files'} · ${formatBytes(total)} · made on this device`}
      contentClassName="p-0"
      className="animate-rise"
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
      {/* Results rise in one after another; the first download gets one gentle pulse. */}
      <ul className="stagger-rise divide-y">
        {results.map((r, i) => (
          <li
            key={r.id}
            className="flex min-w-0 items-center gap-3 px-5 py-2.5"
            style={{ '--i': i } as React.CSSProperties}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={r.name}>
                {r.name}
              </p>
              <p className="font-mono text-[0.7rem] text-muted-foreground">{formatBytes(r.blob.size)}</p>
            </div>
            <Button asChild size="sm" className={i === 0 ? 'relative attention-pulse' : undefined}>
              <a href={r.url} download={r.name}>
                <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                Download
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
