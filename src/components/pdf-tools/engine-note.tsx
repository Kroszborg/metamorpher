import { CloudDownloadIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { formatBytes } from '@/lib/files';

/** "Loads a 10 MB engine once": shown before an engine's first use. */
export function EngineNote({ bytes, name = 'PDF engine' }: { bytes: number; name?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[0.7rem]/relaxed text-muted-foreground">
      <HugeiconsIcon icon={CloudDownloadIcon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
      <span>
        Loads a {formatBytes(bytes)} {name} once, from this site. It is cached for later and works offline.
      </span>
    </p>
  );
}
