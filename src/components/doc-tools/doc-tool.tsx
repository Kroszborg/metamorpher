'use client';

import { useCallback, useMemo, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { EngineNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type Job, useWorkbench } from '@/components/workbench';
import { TYPESET_DOWNLOAD_BYTES } from '@/engines/typeset';
import { isImageFile, resourceMap } from './images';
import type { DocJobOptions, DocReport } from './job';
import { defaultPageSetup, type PageSetup, PageSetupFields } from './options';

export type PasteConfig = {
  /** Default file name for pasted text, e.g. "notes.md". */
  fileName: string;
  type: string;
  placeholder: string;
};

/** "Paste or type" card: turns the text into a file in the list. */
function PasteCard({ config, onAdd, disabled }: { config: PasteConfig; onAdd: (file: File) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const [name, setName] = useState(config.fileName);
  const add = () => {
    const ext = config.fileName.slice(config.fileName.lastIndexOf('.'));
    const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-') || config.fileName;
    const fileName = clean.toLowerCase().endsWith(ext) ? clean : `${clean}${ext}`;
    onAdd(new File([text], fileName, { type: config.type }));
    setText('');
  };
  return (
    <SectionCard title="Paste or type" description="Added to the list as a file, like a dropped one." contentClassName="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={config.placeholder}
        spellCheck={false}
        className="min-h-40 font-mono text-xs"
        disabled={disabled}
        aria-label="Text to convert"
      />
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" className="h-8 text-xs" disabled={disabled} />
        <Button size="sm" onClick={add} disabled={disabled || text.trim() === ''}>
          Add to files
        </Button>
      </div>
    </SectionCard>
  );
}

/**
 * The shared frame of the document-to-PDF tools: files (and pasted text),
 * page setup, tool-specific options, run, and results with notes.
 */
export function DocToPdfTool<E extends object>({
  accept,
  job,
  extra,
  fields,
  setupDefaults,
  allowAuto,
  showOutline,
  showPage = true,
  showTextSize = true,
  textSizeHint,
  paste,
  runLabel = 'Convert to PDF',
  zipName,
  footer,
  imageResources = true,
}: {
  showPage?: boolean;
  showTextSize?: boolean;
  /** Image files in the list are pictures for the documents (Markdown, HTML); false: no special meaning. */
  imageResources?: boolean;
  accept: readonly string[];
  job: Job<E & DocJobOptions>;
  /** Tool-specific options (memoised by the tool). */
  extra: E;
  /** Tool-specific fields, shown above the page setup. */
  fields?: React.ReactNode;
  setupDefaults?: Partial<PageSetup>;
  allowAuto?: boolean;
  showOutline?: boolean;
  textSizeHint?: string;
  paste?: PasteConfig;
  runLabel?: string;
  zipName: string;
  /** Extra lines under the options (what is and is not supported). */
  footer?: React.ReactNode;
}) {
  const [setup, setSetup] = useState<PageSetup>(() => defaultPageSetup(setupDefaults));
  const [reports, setReports] = useState<Record<string, DocReport>>({});
  const onReport = useCallback((id: string, r: DocReport) => setReports((p) => ({ ...p, [id]: r })), []);
  const [files, setFiles] = useState<readonly File[]>([]);
  const resources = useMemo(() => resourceMap(files.filter(isImageFile)), [files]);
  const options = useMemo(() => ({ ...extra, setup, onReport, resources }), [extra, setup, onReport, resources]);
  const wb = useWorkbench({ job, options, accept });
  // The image files in the list, for the job (kept in state so the options stay stable between renders).
  const listed = wb.files.map((f) => f.file);
  if (listed.length !== files.length || listed.some((f, i) => f !== files[i])) setFiles(listed);
  const documents = wb.files.filter((f) => !isImageFile(f.file)).length;

  return (
    <ToolFrame
      wb={wb}
      accept={accept}
      runLabel={runLabel}
      disabledReason={
        imageResources && wb.files.length > 0 && documents === 0 ? 'Add a document to convert (images are only used by documents).' : undefined
      }
      aside={paste ? <PasteCard config={paste} onAdd={(f) => wb.addFiles([f])} disabled={wb.running} /> : null}
      optionsPanel={
        <>
          {fields}
          <PageSetupFields
            id="doc"
            value={setup}
            onChange={setSetup}
            allowAuto={allowAuto}
            showOutline={showOutline}
            showPage={showPage}
            showTextSize={showTextSize}
            textSizeHint={textSizeHint}
          />
          {footer}
          <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName={zipName}
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
    </ToolFrame>
  );
}
