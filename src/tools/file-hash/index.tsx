'use client';

import { Download04Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { proxy } from 'comlink';
import { useCallback, useMemo, useState } from 'react';
import { CopyButton } from '@/components/kit/copy-button';
import { SectionCard } from '@/components/kit/section-card';
import { NoteLine, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { WorkerHost } from '@/engines/worker-host';
import { downloadBlob, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { ALGORITHMS, type Algorithm } from './hashes';
import type { HashWorkerApi } from './hash.worker';

type Digests = Record<Algorithm, string>;
type Entry = { name: string; size: number; digests: Digests; ms: number };
type Options = { onReport: (id: string, entry: Entry) => void };

// One worker per algorithm, created on first use and reused.
const hosts: Record<Algorithm, WorkerHost<HashWorkerApi>> = {
  sha256: new WorkerHost<HashWorkerApi>(() => new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })),
  sha1: new WorkerHost<HashWorkerApi>(() => new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })),
  md5: new WorkerHost<HashWorkerApi>(() => new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })),
};

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const t0 = performance.now();
  const done: Record<Algorithm, number> = { sha256: 0, sha1: 0, md5: 0 };
  let live = true;
  const report = () => {
    if (!live || file.size === 0) return;
    const slowest = Math.min(done.sha256, done.sha1, done.md5);
    ctx.onProgress(slowest / file.size, `${formatBytes(slowest)} of ${formatBytes(file.size)}`);
  };
  try {
    const results = await Promise.all(
      ALGORITHMS.map((a) =>
        hosts[a.id].call(
          (api) =>
            api.hash(
              file,
              a.id,
              proxy((bytes: number) => {
                done[a.id] = bytes;
                report();
              }),
            ),
          ctx.signal,
        ),
      ),
    );
    const digests = Object.fromEntries(ALGORITHMS.map((a, i) => [a.id, results[i] ?? ''])) as Digests;
    o.onReport(input.id, { name: file.name, size: file.size, digests, ms: performance.now() - t0 });
  } catch (err) {
    // Stop the other two when one fails or the run is cancelled.
    for (const h of Object.values(hosts)) h.terminate();
    throw err;
  } finally {
    live = false;
  }
  return [];
});

const clean = (s: string) => s.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
const EXPECTED_LENGTH: Record<number, Algorithm> = { 64: 'sha256', 40: 'sha1', 32: 'md5' };

function checksumFile(entries: Entry[]): Blob {
  const lines = entries.flatMap((e) => [
    `SHA256 (${e.name}) = ${e.digests.sha256}`,
    `SHA1 (${e.name}) = ${e.digests.sha1}`,
    `MD5 (${e.name}) = ${e.digests.md5}`,
  ]);
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
}

export default function FileHash({ tool }: ToolProps) {
  const [expected, setExpected] = useState('');
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const onReport = useCallback((id: string, e: Entry) => setEntries((p) => ({ ...p, [id]: e })), []);
  const options = useMemo<Options>(() => ({ onReport }), [onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });

  const want = clean(expected);
  const wantAlg = EXPECTED_LENGTH[want.length];
  const expectedError = want && !wantAlg ? 'Not a SHA-256 (64), SHA-1 (40) or MD5 (32) hex checksum.' : null;
  const shown = wb.files.flatMap((f) => (entries[f.id] && wb.statuses[f.id]?.state === 'done' ? [entries[f.id]!] : []));

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Compute checksums"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            SHA-256, SHA-1 and MD5 of any file, of any size. The file is read in small pieces, so even multi-gigabyte
            downloads work.
          </p>
          <OptionField
            label="Expected checksum"
            htmlFor="fh-expected"
            hint={expectedError ?? 'Optional: paste the checksum published with the download to compare.'}
          >
            <Input
              id="fh-expected"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="e.g. 9f86d081884c7d65…"
              spellCheck={false}
              aria-invalid={expectedError ? true : undefined}
              className="font-mono"
            />
          </OptionField>
        </>
      }
    >
      {shown.length > 0 ? (
        <SectionCard
          title="Checksums"
          description={`${shown.length} ${shown.length === 1 ? 'file' : 'files'}`}
          action={
            <Button size="sm" variant="outline" onClick={() => downloadBlob(checksumFile(shown), 'checksums.txt')}>
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
              Save as text
            </Button>
          }
          contentClassName="p-0"
        >
          <ul className="divide-y">
            {shown.map((e) => {
              const match = wantAlg ? e.digests[wantAlg] === want : null;
              return (
                <li key={`${e.name}-${e.digests.sha256}`} className="flex flex-col gap-2 px-5 py-3" data-hash-entry="">
                  <p className="text-sm font-medium">
                    {e.name}{' '}
                    <span className="font-mono text-[0.7rem] font-normal text-muted-foreground">
                      {formatBytes(e.size)} · {(e.ms / 1000).toFixed(1)} s
                    </span>
                  </p>
                  <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    {ALGORITHMS.map((a) => (
                      <div key={a.id} className="contents">
                        <dt className="text-xs text-muted-foreground">{a.label}</dt>
                        <dd className="truncate font-mono text-xs select-all" data-alg={a.id} title={e.digests[a.id]}>
                          {e.digests[a.id]}
                        </dd>
                        <CopyButton value={e.digests[a.id]} label={`Copy ${a.label}`} />
                      </div>
                    ))}
                  </dl>
                  {match === true ? (
                    <NoteLine note={{ kind: 'ok', text: `Matches the expected ${ALGORITHMS.find((a) => a.id === wantAlg)?.label} checksum.` }} />
                  ) : match === false ? (
                    <NoteLine
                      note={{
                        kind: 'error',
                        text: `Does not match the expected ${ALGORITHMS.find((a) => a.id === wantAlg)?.label} checksum. The file may be damaged or different from the published one.`,
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
