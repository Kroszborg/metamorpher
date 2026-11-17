'use client';

import { useCallback, useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { PermissionSet } from '@/engines/mupdf';
import { QPDF_DOWNLOAD_BYTES, qpdfEngine } from '@/engines/qpdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Print = 'none' | 'low' | 'high';

type Options = {
  userPassword: string;
  ownerPassword: string;
  print: Print;
  permissions: Omit<PermissionSet, 'print' | 'printHighQuality'>;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const ALLOWED_LABELS: { key: keyof Options['permissions']; label: string }[] = [
  { key: 'copy', label: 'Copy text and images' },
  { key: 'edit', label: 'Edit content' },
  { key: 'annotate', label: 'Add comments' },
  { key: 'fillForms', label: 'Fill in forms' },
  { key: 'assemble', label: 'Insert, delete and rotate pages' },
  { key: 'accessibility', label: 'Screen readers' },
];

function fullPermissions(o: Options): PermissionSet {
  return { ...o.permissions, print: o.print !== 'none', printHighQuality: o.print === 'high' };
}

function restricts(o: Options): boolean {
  const p = fullPermissions(o);
  return Object.values(p).some((v) => !v);
}

function describeRestrictions(p: PermissionSet): string {
  const blocked = [
    !p.print ? 'printing' : !p.printHighQuality ? 'high-quality printing' : null,
    !p.copy ? 'copying' : null,
    !p.edit ? 'editing' : null,
    !p.annotate ? 'comments' : null,
    !p.fillForms ? 'form filling' : null,
    !p.assemble ? 'page changes' : null,
    !p.accessibility ? 'screen readers' : null,
  ].filter(Boolean);
  return blocked.length ? `Blocked without the permissions password: ${blocked.join(', ')}.` : 'No restrictions.';
}

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  ctx.onProgress(0.1, 'Checking the file');
  const current = await qpdfEngine.inspect(file, { signal: ctx.signal });
  if (current.encrypted && current.needsPassword) {
    throw new Error('This PDF already has an open password. Remove it first with Remove PDF password, then encrypt it again.');
  }
  // Without a separate permissions password the open password doubles as the owner password.
  const owner = o.ownerPassword || o.userPassword;
  ctx.onProgress(0.3, 'Encrypting with AES-256');
  const blob = await qpdfEngine.encrypt(
    file,
    { userPassword: o.userPassword, ownerPassword: owner, permissions: fullPermissions(o), algorithm: 'aes-256' },
    { signal: ctx.signal },
  );

  // Check the result independently of the settings: reopen it with and without the password.
  ctx.onProgress(0.8, 'Verifying');
  const notes: ResultNote[] = [];
  const locked = await qpdfEngine.inspect(blob, { signal: ctx.signal });
  const opened = o.userPassword ? await qpdfEngine.inspect(blob, { password: o.userPassword, signal: ctx.signal }) : locked;
  if (!opened.encrypted) throw new Error('Encryption could not be verified: the output is not encrypted.');
  if (o.userPassword) {
    if (!locked.needsPassword) throw new Error('Encryption could not be verified: the output opens without a password.');
    notes.push({ kind: 'ok', text: `Verified: ${opened.method ?? 'encrypted'}, needs the password to open.` });
  } else {
    notes.push({ kind: 'ok', text: `Verified: ${opened.method ?? 'encrypted'}. Opens without a password.` });
  }
  if (opened.permissions && o.ownerPassword) notes.push({ kind: 'info', text: describeRestrictions(opened.permissions) });
  if (current.encrypted) notes.push({ kind: 'info', text: 'The previous restrictions were replaced by these settings.' });
  o.onReport(input.id, notes);
  ctx.onProgress(1);
  return { name: `${baseName(file.name)}-protected.pdf`, blob };
});

export default function EncryptPdf({ tool }: ToolProps) {
  const [userPassword, setUserPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [print, setPrint] = useState<Print>('high');
  const [permissions, setPermissions] = useState<Options['permissions']>({
    copy: true,
    edit: true,
    annotate: true,
    fillForms: true,
    assemble: true,
    accessibility: true,
  });
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, notes: ResultNote[]) => setReports((p) => ({ ...p, [id]: notes })), []);
  const options = useMemo<Options>(
    () => ({ userPassword, ownerPassword, print, permissions, onReport }),
    [userPassword, ownerPassword, print, permissions, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });

  const mismatch = userPassword !== '' && confirm !== userPassword;
  const disabledReason =
    !userPassword && !ownerPassword
      ? 'Enter an open password, a permissions password, or both.'
      : mismatch
        ? 'The two open passwords do not match.'
        : restricts(options) && !ownerPassword
          ? 'Set a permissions password so the restrictions can be enforced.'
          : ownerPassword && ownerPassword === userPassword
            ? 'Use a permissions password that differs from the open password.'
            : null;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Encrypt"
      disabledReason={disabledReason}
      optionsPanel={
        <>
          <OptionField label="Open password" htmlFor="enc-user" hint="Needed to open the PDF. Leave empty to allow opening without one.">
            <PasswordInput id="enc-user" value={userPassword} onChange={setUserPassword} />
          </OptionField>
          {userPassword ? (
            <OptionField label="Confirm open password" htmlFor="enc-confirm">
              <PasswordInput id="enc-confirm" value={confirm} onChange={setConfirm} invalid={mismatch && confirm !== ''} />
            </OptionField>
          ) : null}
          <OptionField
            label="Permissions password"
            htmlFor="enc-owner"
            hint="Needed to change the permissions below. Optional when everything is allowed."
          >
            <PasswordInput id="enc-owner" value={ownerPassword} onChange={setOwnerPassword} placeholder="Optional" />
          </OptionField>

          <OptionField label="Printing">
            <Segmented<Print>
              label="Printing"
              value={print}
              options={[
                { value: 'high', label: 'Allowed' },
                { value: 'low', label: 'Low quality' },
                { value: 'none', label: 'Not allowed' },
              ]}
              onChange={setPrint}
            />
          </OptionField>
          <div className="flex flex-col gap-3">
            {ALLOWED_LABELS.map(({ key, label }) => (
              <SwitchRow
                key={key}
                id={`enc-${key}`}
                label={label}
                checked={permissions[key]}
                onChange={(v) => setPermissions((p) => ({ ...p, [key]: v }))}
              />
            ))}
          </div>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Encrypted with AES-256. Permissions are honoured by well-behaved PDF readers; only the open password truly keeps
            people out.
          </p>
          <EngineNote bytes={QPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="protected-pdfs.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
