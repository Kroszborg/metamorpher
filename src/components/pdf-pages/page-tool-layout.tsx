'use client';

import { Alert02Icon, Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Dropzone, FileList, Results, RunBar, runOutcome, type WorkbenchState } from '@/components/workbench';
import { PASSWORD_PROTECTED } from '@/engines/pdf';
import { getAvailableTool } from '@/tools/registry';
import type { PdfPreviewState } from './use-pdf-preview';

/** A problem opening a PDF, with a way to the unlock tool for encrypted files. */
export function PdfProblem({ message }: { message: string }) {
  const locked = message.includes(PASSWORD_PROTECTED);
  const unlock = locked ? getAvailableTool('unlock-pdf') : undefined;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs/relaxed">
      <HugeiconsIcon
        icon={locked ? SquareLock02Icon : Alert02Icon}
        strokeWidth={2}
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-foreground">{message}</p>
        {unlock ? (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <Link href={`/tools/${unlock.slug}`}>Open {unlock.title}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Placeholder tiles while a PDF is being opened. */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5 p-1" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1 p-1">
          <div className="aspect-[3/4] animate-pulse rounded-md border bg-muted/40" />
          <div className="mx-auto h-3 w-6 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/**
 * The frame for page tools: the file(s) and a page grid on the left, options
 * and the run button on the right, results below. Built from the workbench
 * parts; the tool owns `useWorkbench` and the preview state.
 */
export function PageToolLayout({
  wb,
  accept,
  docs,
  multiple = false,
  reorderable = false,
  runLabel,
  disabledReason,
  optionsPanel,
  pagesTitle = 'Pages',
  pagesDescription,
  pagesAction,
  children,
  zipName,
}: {
  wb: WorkbenchState;
  accept: readonly string[];
  /** Preview state of every added file, in list order. */
  docs: readonly PdfPreviewState[];
  multiple?: boolean;
  reorderable?: boolean;
  runLabel: string;
  /** The tool's own reason to block the run; file and loading checks are built in. */
  disabledReason?: string | null;
  optionsPanel?: React.ReactNode;
  pagesTitle?: React.ReactNode;
  pagesDescription?: React.ReactNode;
  pagesAction?: React.ReactNode;
  /** The page grid. Rendered once every document is ready. */
  children?: React.ReactNode;
  zipName?: string;
}) {
  const count = wb.files.length;
  const problem = docs.find((d) => d.status === 'error')?.error ?? null;
  const loading = docs.some((d) => d.status === 'loading');
  const reason =
    count === 0
      ? multiple
        ? 'Add PDFs to start.'
        : 'Add a PDF to start.'
      : problem
        ? (multiple ? 'Remove the file that cannot be read.' : 'This PDF cannot be used.')
        : loading
          ? 'Reading the PDF…'
          : (disabledReason ?? null);

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
                  ? `${count} ${count === 1 ? 'file' : 'files'}${reorderable && count > 1 ? ' · drag to reorder' : ''}`
                  : undefined
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

          {count > 0 ? (
            <SectionCard
              title={pagesTitle}
              description={problem ? undefined : pagesDescription}
              action={problem || loading ? null : pagesAction}
              contentClassName="p-3"
            >
              {problem ? <PdfProblem message={problem} /> : loading ? <GridSkeleton /> : children}
            </SectionCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          {optionsPanel && count > 0 && !problem ? (
            <SectionCard title="Options" contentClassName="flex flex-col gap-4">
              <fieldset disabled={wb.running || loading} className="flex min-w-0 flex-col gap-4">
                {optionsPanel}
              </fieldset>
            </SectionCard>
          ) : null}
          <RunBar
            label={runLabel}
            running={wb.running}
            progress={wb.progress}
            outcome={runOutcome(wb)}
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
      <Results results={wb.results} zipName={zipName} />
    </div>
  );
}
