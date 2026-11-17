'use client';

import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { EngineNote, NoteLine, PasswordInput, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { type FakeRedaction, MUPDF_DOWNLOAD_BYTES, mupdfEngine, type RedactionCheckerReport } from '@/engines/mupdf';
import type { ToolProps } from '@/tools/types';

type Entry = { name: string; report: RedactionCheckerReport };
type Options = { password: string; onReport: (id: string, e: Entry) => void };

const job = perFile<Options>(async (input, o, ctx) => {
  const report = await mupdfEngine.checkRedactions(input.file, {
    signal: ctx.signal,
    password: o.password || undefined,
    onProgress: (done, total) => ctx.onProgress(done / Math.max(1, total), `Page ${done} of ${total}`),
  });
  o.onReport(input.id, { name: input.file.name, report });
  return [];
});

const KIND: Record<FakeRedaction['kind'], string> = {
  'vector-box': 'Black box drawn over text',
  annotation: 'Black comment or highlight over text',
  image: 'Picture placed over text',
  'unapplied-redaction': 'Redaction mark that was never applied',
  covered: 'Text hidden under dark content',
};

function FileReport({ entry }: { entry: Entry }) {
  const { report } = entry;
  const leaks = report.findings;
  return (
    <SectionCard
      title={entry.name}
      description={`${report.pageCount} ${report.pageCount === 1 ? 'page' : 'pages'} checked`}
      data-report="redaction-check"
    >
      <div className="flex flex-col gap-3">
        {leaks.length === 0 ? (
          <NoteLine
            note={{
              kind: 'ok',
              text:
                report.cleanBoxes > 0
                  ? `No hidden text found. ${report.cleanBoxes} dark ${report.cleanBoxes === 1 ? 'box has' : 'boxes have'} nothing readable underneath.`
                  : 'No hidden text found under dark boxes, black comments or unapplied redaction marks.',
            }}
          />
        ) : (
          <>
            <NoteLine
              note={{
                kind: 'error',
                text: `${leaks.length} ${leaks.length === 1 ? 'place where' : 'places where'} covered text can still be copied out of the file.`,
              }}
            />
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Page</th>
                  <th className="py-2 pr-3 font-medium">What covers it</th>
                  <th className="py-2 font-medium">Text that can be recovered</th>
                </tr>
              </thead>
              <tbody>
                {leaks.map((f) => (
                  <tr key={`${f.page}-${f.box.join(',')}`} className="border-b align-top last:border-0" data-finding={f.kind}>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{f.page + 1}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{KIND[f.kind]}</td>
                    <td className="py-1.5 font-mono break-all">{f.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs/relaxed text-muted-foreground">
              Covering text only hides it on screen. To remove it from the file,{' '}
              <Link href="/tools/redact-pdf" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                redact it properly
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
              </Link>
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}

export default function RedactionChecker({ tool }: ToolProps) {
  const [password, setPassword] = useState('');
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const onReport = useCallback((id: string, e: Entry) => setEntries((p) => ({ ...p, [id]: e })), []);
  const options = useMemo<Options>(() => ({ password, onReport }), [password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const shown = wb.files.flatMap((f) => {
    const e = entries[f.id];
    return e && wb.statuses[f.id]?.state === 'done' ? [{ id: f.id, entry: e }] : [];
  });

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Check redactions"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Finds text that only looks redacted: black boxes or comments drawn over text that is still in the file, and
            redaction marks that were never applied. Nothing is changed.
          </p>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Checks dark covers only; text hidden under white boxes or behind pictures in other colours is not detected.
          </p>
          <OptionField label="Password" htmlFor="rc-password" hint="Only for files that need a password to open.">
            <PasswordInput id="rc-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      {shown.map(({ id, entry }) => (
        <FileReport key={id} entry={entry} />
      ))}
    </ToolFrame>
  );
}
