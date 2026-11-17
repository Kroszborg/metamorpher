'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dropzone, FileList, OptionField, perFile, Results, RunBar, useWorkbench } from '@/components/workbench';
import { type MetadataInfo, type MetadataSpec, type PdfMetadata, pdfStamp } from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Edits = { fileId: string; values: PdfMetadata };
type Options = { removeAll: boolean; edits: Edits | null };

const job = perFile<Options>(async (input, options, ctx) => {
  ctx.onProgress(0.1, options.removeAll ? 'Removing metadata' : 'Writing metadata');
  let spec: MetadataSpec = { removeAll: true };
  if (!options.removeAll) {
    // Untouched form: write back what the file already has (this still refreshes the XMP packet).
    const values =
      options.edits?.fileId === input.id ? options.edits.values : await pdfStamp.readMetadata(input.file, ctx.signal);
    spec = { removeAll: false, values };
  }
  const blob = await pdfStamp.writeMetadata(input.file, spec, ctx.signal);
  return { name: `${baseName(input.file.name)}.pdf`, blob };
});

const TEXT_FIELDS: { key: keyof PdfMetadata; label: string; hint?: string; multiline?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'subject', label: 'Subject', multiline: true },
  { key: 'keywords', label: 'Keywords', hint: 'Usually separated by commas.' },
  { key: 'creator', label: 'Creator', hint: 'The application the document was made in.' },
  { key: 'producer', label: 'Producer', hint: 'The application that wrote the PDF.' },
];

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Read = { fileId: string; info: MetadataInfo | null; error: string | null };

export default function EditPdfMetadata({ tool }: ToolProps) {
  const [removeAll, setRemoveAll] = useState(false);
  const [edits, setEdits] = useState<Edits | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const options = useMemo<Options>(() => ({ removeAll, edits }), [removeAll, edits]);
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;
  const fileId = input?.id ?? null;

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    pdfStamp.readMetadata(input.file).then(
      (info) => {
        if (!cancelled) setRead({ fileId: input.id, info, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setRead({ fileId: input.id, info: null, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input]);

  const current = read?.fileId === fileId ? read : null;
  const values: PdfMetadata | null = edits?.fileId === fileId ? edits.values : (current?.info ?? null);

  const setField = (key: keyof PdfMetadata, value: string) => {
    if (!fileId || !values) return;
    setEdits({ fileId, values: { ...values, [key]: value } });
  };

  const disabledReason = !input
    ? 'Add a PDF to start.'
    : current?.error
      ? current.error
      : !values
        ? 'Reading the metadata…'
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="File"
            description={input ? 'One PDF at a time. Adding another replaces it.' : 'Files stay on this device. Nothing is uploaded.'}
            action={
              input ? (
                <Button variant="ghost" size="sm" onClick={wb.reset} disabled={wb.running}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  Clear
                </Button>
              ) : null
            }
            contentClassName="flex flex-col gap-3"
          >
            {input ? (
              <FileList
                files={wb.files}
                statuses={wb.statuses}
                disabled={wb.running}
                reorderable={false}
                onRemove={wb.removeFile}
                onMove={wb.moveFile}
              />
            ) : null}
            <Dropzone accept={tool.accept} multiple={false} disabled={wb.running} compact={!!input} onFiles={wb.addFiles} />
          </SectionCard>

          {input && current?.error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs/relaxed text-destructive">
              {current.error}
            </p>
          ) : null}

          {input && values ? (
            <SectionCard
              title="Metadata"
              description={
                current?.info
                  ? `${current.info.pageCount} ${current.info.pageCount === 1 ? 'page' : 'pages'} · ${
                      current.info.hasXmp ? 'has an XMP metadata packet' : 'no XMP metadata packet'
                    }`
                  : undefined
              }
            >
              <fieldset
                disabled={wb.running || removeAll}
                className="grid min-w-0 gap-4 disabled:opacity-60 sm:grid-cols-2"
              >
                {TEXT_FIELDS.map((f) => (
                  <OptionField
                    key={f.key}
                    label={f.label}
                    htmlFor={`md-${f.key}`}
                    hint={f.hint}
                    className={f.multiline ? 'sm:col-span-2' : undefined}
                  >
                    {f.multiline ? (
                      <Textarea
                        id={`md-${f.key}`}
                        rows={2}
                        value={values[f.key]}
                        onChange={(e) => setField(f.key, e.currentTarget.value)}
                      />
                    ) : (
                      <Input id={`md-${f.key}`} value={values[f.key]} onChange={(e) => setField(f.key, e.currentTarget.value)} />
                    )}
                  </OptionField>
                ))}
                <OptionField label="Created" htmlFor="md-created">
                  <Input
                    id="md-created"
                    type="datetime-local"
                    value={values.creationDate}
                    onChange={(e) => setField('creationDate', e.currentTarget.value)}
                  />
                </OptionField>
                <OptionField label="Modified" htmlFor="md-modified">
                  <div className="flex gap-1.5">
                    <Input
                      id="md-modified"
                      type="datetime-local"
                      value={values.modDate}
                      onChange={(e) => setField('modDate', e.currentTarget.value)}
                    />
                    <Button type="button" variant="outline" size="sm" className="h-auto" onClick={() => setField('modDate', nowLocal())}>
                      Now
                    </Button>
                  </div>
                </OptionField>
              </fieldset>
              <p className="mt-4 text-[0.7rem]/relaxed text-muted-foreground">
                Empty fields are removed. The XMP packet is rewritten to match, so readers that prefer XMP show the same
                values.
              </p>
            </SectionCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <SectionCard title="Options" contentClassName="flex flex-col gap-4">
            <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
              <SwitchRow
                id="md-remove"
                label="Remove all metadata"
                checked={removeAll}
                onChange={setRemoveAll}
                hint="Deletes the information dictionary, the XMP packet and page-level metadata. Everything else is kept."
              />
            </fieldset>
          </SectionCard>
          <RunBar
            label={removeAll ? 'Remove metadata' : 'Save metadata'}
            running={wb.running}
            progress={wb.progress}
            note={wb.note}
            disabledReason={disabledReason}
            onRun={wb.run}
            onCancel={wb.cancel}
          />
          <p className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            Processed in your browser. Your files never leave this device.
          </p>
        </div>
      </div>
      <Results results={wb.results} />
    </div>
  );
}
