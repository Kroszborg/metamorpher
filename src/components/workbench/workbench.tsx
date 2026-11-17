'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Dropzone } from './dropzone';
import { FileList } from './file-list';
import { Results } from './results';
import { RunBar } from './run-bar';
import type { InputFile, Job } from './types';
import { useWorkbench } from './use-workbench';

export type WorkbenchProps<O> = {
  job: Job<O>;
  /** The tool's current options, passed to `job.run`. */
  options: O;
  /** Accepted inputs; usually `tool.accept` from the registry. */
  accept: readonly string[];
  /** false: one file at a time (a new one replaces it). Default true. */
  multiple?: boolean;
  /** Let the user drag files into order (for jobs where order matters). */
  reorderable?: boolean;
  /** Fewest files needed before the run button enables. Default 1. */
  minFiles?: number;
  /** Controls rendered in the options panel. Omit for tools without options. */
  optionsPanel?: React.ReactNode;
  /** Run button label, such as "Convert" or "Merge PDFs". */
  runLabel: string;
  /** Return a message to block the run (shown under the button), or null to allow it. */
  validate?: (files: InputFile[], options: O) => string | null;
  /** Name of the "download all" archive. */
  zipName?: string;
};

/**
 * The shared tool frame: files on the left, options and the run button on
 * the right, results below. Tools only supply a job, options and controls.
 */
export function Workbench<O>({
  job,
  options,
  accept,
  multiple = true,
  reorderable = false,
  minFiles = 1,
  optionsPanel,
  runLabel,
  validate,
  zipName,
}: WorkbenchProps<O>) {
  const wb = useWorkbench({ job, options, accept, multiple });
  const count = wb.files.length;

  const disabledReason =
    count === 0
      ? `Add ${multiple ? 'files' : 'a file'} to start.`
      : count < minFiles
        ? `Add at least ${minFiles} files.`
        : (validate?.(wb.files, options) ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title="Files"
          description={
            count === 0
              ? 'Files stay on this device. Nothing is uploaded.'
              : `${count} ${count === 1 ? 'file' : 'files'}${reorderable && count > 1 ? ' · drag to reorder' : ''}`
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
              reorderable={reorderable}
              onRemove={wb.removeFile}
              onMove={wb.moveFile}
            />
          ) : null}
          <Dropzone
            accept={accept}
            multiple={multiple}
            disabled={wb.running}
            compact={count > 0}
            onFiles={wb.addFiles}
          />
        </SectionCard>

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
      <Results results={wb.results} zipName={zipName} />
    </div>
  );
}
