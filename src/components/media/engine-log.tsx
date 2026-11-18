'use client';

import { Alert02Icon, FlashIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { SectionCard } from '@/components/kit/section-card';
import { StatusBadge } from '@/components/kit/status-badge';
import { type Capabilities, type Container, describeFallback, plannedFallback, type VideoCodecId } from '@/engines/media';
import { formatBytes } from '@/lib/files';
import { type JobLog, useJobLog } from './job-log';
import { useCapabilities } from './use-media';

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/** Which engine handled each file, what it did to each track, and why it fell back if it did. */
export function EngineLog({ log }: { log: JobLog }) {
  const entries = useJobLog(log);
  if (entries.length === 0) return null;
  return (
    <SectionCard title="Engine report" description="How each file was processed on this device." contentClassName="p-0">
      <ul className="divide-y">
        {entries.map((e, i) => (
          <li key={`${e.output}-${i}`} className="flex flex-col gap-1 px-5 py-3 text-xs">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 truncate font-medium text-foreground" title={e.name}>
                {e.name}
              </span>
              <StatusBadge kind={e.report.engine === 'mediabunny' ? 'success' : 'warning'}>{e.report.engineLabel}</StatusBadge>
              <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground tabular-nums">
                {seconds(e.report.ms)} · {formatBytes(e.size)}
              </span>
            </div>
            {e.report.fallback ? (
              <p className="flex items-start gap-1.5 text-warning">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
                {describeFallback(e.report.fallback)}
              </p>
            ) : null}
            {e.report.video ? <p className="text-muted-foreground">Video: {e.report.video}</p> : null}
            {e.report.audio ? <p className="text-muted-foreground">Audio: {e.report.audio}</p> : null}
            {e.report.notes.map((n) => (
              <p key={n} className="text-muted-foreground">
                {n}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * One line under the options saying which engine the current choice will
 * use, and why when it is the slower one.
 */
export function EngineHint({
  container,
  videoCodec,
  extra,
}: {
  container: Container | 'gif';
  videoCodec?: VideoCodecId | 'auto';
  extra?: string | null;
}) {
  const caps: Capabilities | null = useCapabilities();
  const reason = plannedFallback(caps, container, videoCodec);
  if (reason) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[0.7rem]/relaxed text-warning">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
        <span>
          {describeFallback(reason)} The first run downloads it (about 31 MB). It reads files of any size but builds the result in memory, so results over 1 GB cannot be made with it.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-[0.7rem]/relaxed text-muted-foreground">
      <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
      <span>
        Runs on WebCodecs (hardware-accelerated where your device supports it) and streams the file, so large inputs are
        fine. {extra ?? 'Inputs WebCodecs cannot read fall back to a slower software engine, and the report says so.'}
      </span>
    </p>
  );
}
