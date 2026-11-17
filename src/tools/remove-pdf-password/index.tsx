'use client';

import { useCallback, useMemo, useState } from 'react';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { QPDF_DOWNLOAD_BYTES, qpdfEngine } from '@/engines/qpdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { password: string; onReport: (id: string, notes: ResultNote[]) => void };

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  ctx.onProgress(0.1, 'Checking the file');
  const before = await qpdfEngine.inspect(file, { signal: ctx.signal });
  if (!before.encrypted) throw new Error('This PDF is not password-protected.');
  if (!before.needsPassword) {
    throw new Error('This PDF opens without a password. To lift its printing or copying limits, use Unlock restrictions.');
  }
  ctx.onProgress(0.3, 'Decrypting');
  // A wrong password rejects with "That password is not correct for this PDF."
  const blob = await qpdfEngine.decrypt(file, o.password, { signal: ctx.signal });
  ctx.onProgress(0.8, 'Verifying');
  const after = await qpdfEngine.inspect(blob, { signal: ctx.signal });
  if (after.encrypted) throw new Error('The password was accepted but the output is still encrypted.');
  o.onReport(input.id, [{ kind: 'ok', text: 'Verified: the new file opens without a password and has no restrictions.' }]);
  ctx.onProgress(1);
  return { name: `${baseName(file.name)}-unlocked.pdf`, blob };
});

export default function RemovePdfPassword({ tool }: ToolProps) {
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, notes: ResultNote[]) => setReports((p) => ({ ...p, [id]: notes })), []);
  const options = useMemo<Options>(() => ({ password, onReport }), [password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Remove password"
      disabledReason={password ? null : 'Enter the password that opens the PDF.'}
      optionsPanel={
        <>
          <OptionField
            label="Password"
            htmlFor="rp-password"
            hint="The password you use to open the file. Files with several protected PDFs need the same password."
          >
            <PasswordInput id="rp-password" value={password} onChange={setPassword} />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            This only works with the right password: Metamorpher does not guess or crack passwords.
          </p>
          <EngineNote bytes={QPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="unlocked-pdfs.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
