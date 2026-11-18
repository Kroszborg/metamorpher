'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import {
  Dropzone,
  FileList,
  type InputFile,
  type Job,
  OptionSelect,
  Results,
  RunBar,
  runOutcome,
  useWorkbench,
} from '@/components/workbench';
import { type PreviewRequest, pdfStamp } from '@/engines/pdf-stamp';
import { PdfStage } from './stage';

export type PreviewContext = {
  file: File;
  /** Position of `file` in the list. */
  index: number;
  files: InputFile[];
  /** 0-based page being previewed. */
  page: number;
};

export type PreviewWorkbenchProps<O> = {
  job: Job<O>;
  options: O;
  accept: readonly string[];
  runLabel: string;
  optionsPanel: React.ReactNode;
  /** Builds the request for the live preview of one page; return null to show the page unchanged. */
  preview: (options: O, ctx: PreviewContext) => Promise<PreviewRequest | null> | PreviewRequest | null;
  validate?: (files: InputFile[], options: O) => string | null;
  reorderable?: boolean;
  zipName?: string;
  /** A note under the preview, such as a warning that a mode rasterises. */
  previewNote?: React.ReactNode;
};

/**
 * The workbench layout plus a live preview: the chosen page of the chosen
 * file is processed with the current options (one page only) and shown in a
 * `PdfStage`, so the preview is the real output.
 */
export function PreviewWorkbench<O>({
  job,
  options,
  accept,
  runLabel,
  optionsPanel,
  preview,
  validate,
  reorderable = false,
  zipName,
  previewNote,
}: PreviewWorkbenchProps<O>) {
  const wb = useWorkbench({ job, options, accept, multiple: true });
  const count = wb.files.length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, wb.files.findIndex((f) => f.id === selectedId));
  const selected = wb.files[selectedIndex] ?? null;
  const fileId = selected?.id ?? null;
  // Everything below is keyed by the file it belongs to, so switching files needs no reset.
  const [pageState, setPageState] = useState<{ fileId: string | null; page: number }>({ fileId: null, page: 0 });
  const page = pageState.fileId === fileId ? pageState.page : 0;
  const setPage = (p: number) => setPageState({ fileId, page: p });
  const [info, setInfo] = useState<{ fileId: string; pageCount: number; error: string | null } | null>(null);
  const pageCount = info?.fileId === fileId ? info.pageCount : 0;
  const [result, setResult] = useState<{
    fileId: string;
    pdf: Blob | null;
    renderPage: number;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Page count of the selected file (also surfaces encrypted files early).
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    pdfStamp.pageSizes(selected.file).then(
      (sizes) => {
        if (!cancelled) setInfo({ fileId: selected.id, pageCount: sizes.length, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setInfo({ fileId: selected.id, pageCount: 0, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Debounced live preview of the current page.
  useEffect(() => {
    if (!selected || pageCount === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const request = await preview(options, {
          file: selected.file,
          index: selectedIndex,
          files: wb.files,
          page,
        });
        const pdf = request ? await pdfStamp.preview(selected.file, request, page) : null;
        if (cancelled) return;
        // Without a request the page is shown unchanged, straight from the original file.
        setResult({ fileId: selected.id, pdf: pdf ?? selected.file, renderPage: pdf ? 0 : page, error: null });
      } catch (err) {
        if (!cancelled) {
          setResult((r) => ({
            fileId: selected.id,
            pdf: r?.fileId === selected.id ? r.pdf : null,
            renderPage: r?.fileId === selected.id ? r.renderPage : 0,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [options, selected, selectedIndex, page, pageCount, preview, wb.files]);

  const current = result?.fileId === fileId ? result : null;
  const previewError = (info?.fileId === fileId ? info.error : null) ?? current?.error ?? null;

  const disabledReason =
    count === 0 ? 'Add files to start.' : (validate?.(wb.files, options) ?? null);

  const fileChoices = useMemo(
    () => wb.files.map((f, i) => ({ value: f.id, label: `${i + 1}. ${f.file.name}` })),
    [wb.files],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
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
            <Dropzone accept={accept} multiple disabled={wb.running} compact={count > 0} onFiles={wb.addFiles} />
          </SectionCard>

          {selected ? (
            <SectionCard
              title="Preview"
              description="The selected page, processed with the current options."
              action={
                count > 1 ? (
                  <div className="w-56">
                    <OptionSelect
                      id="pw-file"
                      value={selected.id}
                      options={fileChoices}
                      onChange={(id) => setSelectedId(id)}
                    />
                  </div>
                ) : null
              }
              contentClassName="flex flex-col gap-2 p-3"
            >
              <PdfStage
                file={current?.pdf ?? null}
                page={page}
                pageCount={pageCount}
                renderPage={current?.renderPage ?? 0}
                onPageChange={setPage}
                busy={busy}
                error={previewError}
                placeholder="Preparing the preview…"
              />
              {previewNote ? <div className="px-1 text-[0.7rem]/relaxed text-muted-foreground">{previewNote}</div> : null}
            </SectionCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <SectionCard title="Options" contentClassName="flex flex-col gap-4">
            <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
              {optionsPanel}
            </fieldset>
          </SectionCard>
          <RunBar
            label={runLabel}
            running={wb.running}
            progress={wb.progress}
            outcome={runOutcome(wb)}
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
