'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Dropzone, FileList, type InputFile, type Job, Results, RunBar, runOutcome, useWorkbench } from '@/components/workbench';
import { EngineLog } from './engine-log';
import type { JobLog } from './job-log';

export type MediaWorkbenchProps<O> = {
  job: Job<O>;
  options: O;
  accept: readonly string[];
  log: JobLog;
  runLabel: string;
  multiple?: boolean;
  reorderable?: boolean;
  minFiles?: number;
  /** Options panel content, or a function of the current files (for per-file estimates). */
  optionsPanel?: React.ReactNode | ((files: InputFile[]) => React.ReactNode);
  /** Shown above the file list when there are files (player, timeline). */
  preview?: (files: InputFile[], running: boolean) => React.ReactNode;
  validate?: (files: InputFile[], options: O) => string | null;
  zipName?: string;
};

/**
 * The workbench layout for media tools: the shared pieces from
 * `@/components/workbench` plus a preview slot and the engine report.
 */
export function MediaWorkbench<O>({
  job,
  options,
  accept,
  log,
  runLabel,
  multiple = true,
  reorderable = false,
  minFiles = 1,
  optionsPanel,
  preview,
  validate,
  zipName,
}: MediaWorkbenchProps<O>) {
  const wb = useWorkbench({ job, options, accept, multiple });
  const count = wb.files.length;
  const disabledReason =
    count === 0
      ? `Add ${multiple ? 'files' : 'a file'} to start.`
      : count < minFiles
        ? `Add at least ${minFiles} files.`
        : (validate?.(wb.files, options) ?? null);
  const panel = typeof optionsPanel === 'function' ? optionsPanel(wb.files) : optionsPanel;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {preview && count > 0 ? preview(wb.files, wb.running) : null}
          <SectionCard
            title="Files"
            description={
              count === 0
                ? 'Files stay on this device. Nothing is uploaded.'
                : `${count} ${count === 1 ? 'file' : 'files'}${reorderable && count > 1 ? ' · drag to reorder' : ''}`
            }
            action={
              count > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    log.clear();
                    wb.reset();
                  }}
                  disabled={wb.running}
                >
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
            <Dropzone accept={accept} multiple={multiple} disabled={wb.running} compact={count > 0} onFiles={wb.addFiles} />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          {panel ? (
            <SectionCard title="Options" contentClassName="flex flex-col gap-4">
              <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
                {panel}
              </fieldset>
            </SectionCard>
          ) : null}
          <RunBar
            label={runLabel}
            running={wb.running}
            progress={wb.progress}
            outcome={runOutcome(wb)}
            note={wb.note}
            disabledReason={disabledReason}
            onRun={() => {
              log.clear();
              void wb.run();
            }}
            onCancel={wb.cancel}
          />
          <p className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            Processed in your browser. Your files never leave this device.
          </p>
        </div>
      </div>
      <Results results={wb.results} zipName={zipName} />
      <EngineLog log={log} />
    </div>
  );
}
