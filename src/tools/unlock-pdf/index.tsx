'use client';

import { useCallback, useMemo, useState } from 'react';
import { EngineNote, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { perFile, useWorkbench } from '@/components/workbench';
import type { PermissionSet } from '@/engines/mupdf';
import { QPDF_DOWNLOAD_BYTES, qpdfEngine } from '@/engines/qpdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { onReport: (id: string, notes: ResultNote[]) => void };

function blocked(p: PermissionSet | null): string[] {
  if (!p) return [];
  return [
    !p.print ? 'printing' : !p.printHighQuality ? 'high-quality printing' : null,
    !p.copy ? 'copying' : null,
    !p.edit ? 'editing' : null,
    !p.annotate ? 'comments' : null,
    !p.fillForms ? 'form filling' : null,
    !p.assemble ? 'page changes' : null,
    !p.accessibility ? 'screen readers' : null,
  ].filter((x): x is string => x !== null);
}

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  ctx.onProgress(0.1, 'Checking the file');
  const before = await qpdfEngine.inspect(file, { signal: ctx.signal });
  if (!before.encrypted) throw new Error('This PDF has no restrictions to remove.');
  if (before.needsPassword) {
    throw new Error('This PDF needs a password to open. Use Remove PDF password with that password instead.');
  }
  ctx.onProgress(0.3, 'Removing restrictions');
  const blob = await qpdfEngine.removeRestrictions(file, { signal: ctx.signal });
  const after = await qpdfEngine.inspect(blob, { signal: ctx.signal });
  if (after.encrypted) throw new Error('The restrictions could not be removed.');
  const lifted = blocked(before.permissions);
  o.onReport(input.id, [
    {
      kind: 'ok',
      text: lifted.length
        ? `Removed limits on ${lifted.join(', ')}. Verified: the new file is not encrypted.`
        : 'Removed the encryption (it set no limits). Verified: the new file is not encrypted.',
    },
  ]);
  ctx.onProgress(1);
  return { name: `${baseName(file.name)}-unrestricted.pdf`, blob };
});

export default function UnlockPdf({ tool }: ToolProps) {
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, notes: ResultNote[]) => setReports((p) => ({ ...p, [id]: notes })), []);
  const options = useMemo<Options>(() => ({ onReport }), [onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Unlock"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            For PDFs that open without a password but block printing, copying or editing. Only remove restrictions from
            files you have the right to use this way.
          </p>
          <EngineNote bytes={QPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="unrestricted-pdfs.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
