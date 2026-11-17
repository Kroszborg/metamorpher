'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Dropzone, FileList, RunBar, type WorkbenchState } from '@/components/workbench';

/**
 * The workbench layout (files left, options and run bar right) with the
 * results area left to the tool, for tools that report more than a list of
 * downloads (sizes before and after, verification, findings).
 */
export function ToolFrame({
  wb,
  accept,
  multiple = true,
  runLabel,
  disabledReason,
  optionsPanel,
  aside,
  children,
}: {
  wb: WorkbenchState;
  accept: readonly string[];
  multiple?: boolean;
  runLabel: string;
  /** Overrides the default "add a file" reason; null enables the run button. */
  disabledReason?: string | null;
  optionsPanel?: React.ReactNode;
  /** Extra content under the file list (a preview, a page picker). */
  aside?: React.ReactNode;
  /** Results and reports, shown under the frame. */
  children?: React.ReactNode;
}) {
  const count = wb.files.length;
  // The file list only shows errors in a tooltip; say them out loud (wrong password, damaged file).
  const failures = wb.files.flatMap((f) => {
    const st = wb.statuses[f.id];
    return st?.state === 'error' && st.error ? [{ id: f.id, name: f.file.name, error: st.error }] : [];
  });
  const reason =
    count === 0 ? `Add ${multiple ? 'files' : 'a file'} to start.` : disabledReason === undefined ? null : disabledReason;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title={multiple ? 'Files' : 'File'}
            description={
              count === 0
                ? 'Files stay on this device. Nothing is uploaded.'
                : multiple
                  ? `${count} ${count === 1 ? 'file' : 'files'}`
                  : 'One file at a time. Adding another replaces it.'
            }
            action={
              count > 0 ? (
                <Button variant="ghost" size="sm" onClick={wb.reset} disabled={wb.running}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  Clear
                </Button>
              ) : null
            }
            contentClassName="flex flex-col gap-3"
          >
            {count > 0 ? (
              <FileList
                files={wb.files}
                statuses={wb.statuses}
                disabled={wb.running}
                reorderable={false}
                onRemove={wb.removeFile}
                onMove={wb.moveFile}
              />
            ) : null}
            <Dropzone accept={accept} multiple={multiple} disabled={wb.running} compact={count > 0} onFiles={wb.addFiles} />
          </SectionCard>
          {failures.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              {failures.map((f) => (
                <p key={f.id} className="text-xs/relaxed text-destructive" data-file-error>
                  {count > 1 ? <span className="font-medium">{f.name}: </span> : null}
                  {f.error}
                </p>
              ))}
            </div>
          ) : null}
          {aside}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          {optionsPanel ? (
            <SectionCard title="Options" contentClassName="flex flex-col gap-4">
              <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
                {optionsPanel}
              </fieldset>
            </SectionCard>
          ) : null}
          <RunBar
            label={runLabel}
            running={wb.running}
            progress={wb.progress}
            note={wb.note}
            disabledReason={reason}
            onRun={wb.run}
            onCancel={wb.cancel}
          />
          <p className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            Processed in your browser. Your files never leave this device.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
