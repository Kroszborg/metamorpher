'use client';

import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BinaryCodeIcon,
  Cancel01Icon,
  CodeSquareIcon,
  Database01Icon,
  Doc01Icon,
  FileTextIcon,
  FileZipIcon,
  FolderOpenIcon,
  FullScreenIcon,
  GridTableIcon,
  Image01Icon,
  KeyboardIcon,
  MinimizeScreenIcon,
  MusicNote01Icon,
  Pdf01Icon,
  SquareLock02Icon,
  SubtitleIcon,
  TextFontIcon,
  TextIcon,
  Video01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { useRouter } from 'next/navigation';
import {
  Component,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Dropzone } from '@/components/workbench/dropzone';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { getAvailableTool } from '@/tools/registry';
import type { ToolInfo } from '@/tools/types';
import { IconButton, Kbd, ViewerLoading, ViewerProblem } from './bits';
import { type Shortcut, useKeys, ViewerContext } from './context';
import { handOff, takeHandoff } from './handoff';
import { KIND_INFO, VIEWER_SLUGS } from './kinds';
import { OpenWith } from './open-with';
import { type Sniffed, sniffFile, type ViewKind } from './sniff';
import { KindViewer } from './viewers';

export const KIND_ICON: Record<ViewKind, IconSvgElement> = {
  table: GridTableIcon,
  data: CodeSquareIcon,
  text: FileTextIcon,
  markdown: TextIcon,
  hex: BinaryCodeIcon,
  pdf: Pdf01Icon,
  document: Doc01Icon,
  image: Image01Icon,
  video: Video01Icon,
  audio: MusicNote01Icon,
  archive: FileZipIcon,
  font: TextFontIcon,
  sqlite: Database01Icon,
  subtitle: SubtitleIcon,
};

const FRAME_SHORTCUTS: Shortcut[] = [
  { keys: 'F', label: 'Fullscreen on or off' },
  { keys: 'O', label: 'Open another file' },
  { keys: '[  ]', label: 'Previous or next file' },
  { keys: '?', label: 'Show these shortcuts' },
];

const fileIds = new WeakMap<File, number>();
let nextId = 1;
function fileKey(f: File): number {
  let id = fileIds.get(f);
  if (!id) {
    id = nextId++;
    fileIds.set(f, id);
  }
  return id;
}

class ViewerBoundary extends Component<
  { children: ReactNode; onViewAs: (k: ViewKind) => void; textual: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = /chunk|module|import/i.test(error.message) && /load|fetch/i.test(error.message);
    return (
      <ViewerProblem
        title={chunk ? 'This viewer could not load' : 'This file could not be shown'}
        actions={
          chunk ? (
            <Button variant="outline" size="lg" onClick={() => window.location.reload()}>
              Reload
            </Button>
          ) : (
            <>
              {this.props.textual ? (
                <Button variant="outline" size="lg" onClick={() => this.props.onViewAs('text')}>
                  View as text
                </Button>
              ) : null}
              <Button variant="outline" size="lg" onClick={() => this.props.onViewAs('hex')}>
                View bytes (hex)
              </Button>
            </>
          )
        }
      >
        {chunk
          ? 'Check your connection and reload. Offline, a viewer works once it has been used before.'
          : `${error.message || 'It may be damaged or not the format its name suggests.'}`}
      </ViewerProblem>
    );
  }
}

/** Kinds a person can switch to for this file, the detected one first. */
function viewChoices(s: Sniffed): ViewKind[] {
  const textual = s.encoding !== undefined;
  const list: ViewKind[] = [s.kind];
  if (textual) list.push('text', 'table', 'data', 'markdown');
  list.push('hex');
  return [...new Set(list)];
}

const CHOICE_LABEL: Record<ViewKind, string> = {
  table: 'Table',
  data: 'Data tree',
  text: 'Text',
  markdown: 'Markdown',
  hex: 'Hex',
  pdf: 'PDF',
  document: 'Document',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archive',
  font: 'Font',
  sqlite: 'Database',
  subtitle: 'Subtitles',
};

type FileViewProps = {
  tool: ToolInfo;
  kinds: ViewKind[] | 'any';
  as?: ViewKind;
  files: File[];
  index: number;
  onIndex: (i: number) => void;
  onOpen: () => void;
  onClose: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
};

function FileView({ tool, kinds, as, files, index, onIndex, onOpen, onClose, fullscreen, onFullscreen }: FileViewProps) {
  const router = useRouter();
  const file = files[index]!;
  const [sniffed, setSniffed] = useState<Sniffed | null>(null);
  const [sniffError, setSniffError] = useState<string | null>(null);
  const [viewAs, setViewAs] = useState<ViewKind | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let live = true;
    sniffFile(file).then(
      (s) => live && setSniffed(s),
      (err: unknown) => live && setSniffError(err instanceof Error ? err.message : 'The file could not be read.'),
    );
    return () => {
      live = false;
    };
  }, [file]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'f' || e.key === 'F') onFullscreen();
      else if (e.key === 'o' || e.key === 'O') onOpen();
      else if (e.key === '?') setHelp(true);
      else if (e.key === '[' && files.length > 1) onIndex((index - 1 + files.length) % files.length);
      else if (e.key === ']' && files.length > 1) onIndex((index + 1) % files.length);
      else return false;
      return true;
    },
    [onFullscreen, onOpen, files.length, index, onIndex],
  );
  useKeys(onKey);

  const api = useMemo(() => ({ fullscreen, setShortcuts, viewAs: setViewAs }), [fullscreen]);
  // A tool's own viewer applies to text files (or to everything, for the hex viewer).
  const preferred = sniffed && as && (as === 'hex' || sniffed.encoding !== undefined) ? as : null;
  const kind = viewAs ?? preferred ?? sniffed?.kind ?? null;
  const wrongKind = sniffed && !viewAs && !preferred && kinds !== 'any' && !kinds.includes(sniffed.kind);
  const unsupported = sniffed?.unsupported && !viewAs && !preferred ? sniffed.unsupported : null;
  const choices = sniffed ? viewChoices(sniffed) : [];

  let body: ReactNode;
  if (sniffError) {
    body = <ViewerProblem title="This file could not be read">{sniffError}</ViewerProblem>;
  } else if (!sniffed || !kind) {
    body = <ViewerLoading label="Reading the file…" />;
  } else if (wrongKind && sniffed.kind === 'hex' && !sniffed.unsupported) {
    body = (
      <ViewerProblem
        title={`This does not look like ${KIND_INFO[(kinds as ViewKind[])[0]!].noun}`}
        actions={
          <Button size="lg" variant="outline" onClick={() => setViewAs('hex')}>
            View bytes (hex)
          </Button>
        }
      >
        The file holds binary data that is not a format this viewer knows. It may be damaged, encrypted, or a
        different kind of file with the wrong name.
      </ViewerProblem>
    );
  } else if (wrongKind) {
    const info = KIND_INFO[sniffed.kind];
    body = (
      <ViewerProblem
        tone="neutral"
        icon={KIND_ICON[sniffed.kind]}
        title={`This is ${sniffed.format.match(/^[AEIOU]/i) ? 'an' : 'a'} ${sniffed.format}, not ${KIND_INFO[(kinds as ViewKind[])[0]!].noun}`}
        actions={
          <>
            {getAvailableTool(info.slug) ? (
              <Button size="lg" onClick={() => handOff(info.slug, files, (href) => router.push(href), VIEWER_SLUGS)}>
                Open in {info.label}
              </Button>
            ) : null}
            <Button size="lg" variant="outline" onClick={() => setViewAs(sniffed.kind)}>
              Show it here
            </Button>
          </>
        }
      >
        {tool.title} shows {KIND_INFO[(kinds as ViewKind[])[0]!].noun}.
        {getAvailableTool(info.slug) ? ` The ${info.label.toLowerCase()} shows ${info.noun}.` : ''}
      </ViewerProblem>
    );
  } else if (unsupported) {
    body = (
      <ViewerProblem
        title={`${sniffed.format} files cannot be shown here`}
        actions={
          <Button size="lg" variant="outline" onClick={() => setViewAs('hex')}>
            View bytes (hex)
          </Button>
        }
      >
        {unsupported}
      </ViewerProblem>
    );
  } else {
    body = (
      <ViewerBoundary key={`${kind}`} onViewAs={setViewAs} textual={sniffed.encoding !== undefined}>
        <Suspense fallback={<ViewerLoading label={`Loading the ${CHOICE_LABEL[kind].toLowerCase()} viewer…`} />}>
          <KindViewer kind={kind} file={file} sniff={sniffed} files={files} index={index} onIndex={onIndex} />
        </Suspense>
      </ViewerBoundary>
    );
  }

  const icon = KIND_ICON[kind ?? 'hex'];
  return (
    <ViewerContext.Provider value={api}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[0.6rem] bg-primary/10 text-primary">
            <HugeiconsIcon icon={icon} strokeWidth={1.9} className="size-[1.15rem]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground" title={file.name}>
              {file.name || 'Pasted file'}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>{sniffed?.format ?? 'Detecting…'}</span>
              <span aria-hidden>·</span>
              <span>{formatBytes(file.size)}</span>
              {sniffed?.encoding && sniffed.encoding !== 'UTF-8' ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{sniffed.encoding}</span>
                </>
              ) : null}
              {sniffed?.mismatch ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
                  named .{file.name.split('.').pop()?.toLowerCase()}, but the content is {sniffed.format}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {files.length > 1 ? (
            <div className="mr-1 flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
              <IconButton
                icon={ArrowLeft01Icon}
                label="Previous file ([)"
                className="h-7 min-w-7"
                onClick={() => onIndex((index - 1 + files.length) % files.length)}
              />
              <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
                {index + 1} / {files.length}
              </span>
              <IconButton
                icon={ArrowRight01Icon}
                label="Next file (])"
                className="h-7 min-w-7"
                onClick={() => onIndex((index + 1) % files.length)}
              />
            </div>
          ) : null}
          {choices.length > 1 ? (
            <label className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="max-sm:sr-only">View as</span>
              <select
                aria-label="View as"
                value={kind ?? ''}
                onChange={(e) => setViewAs(e.target.value as ViewKind)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {choices.map((k, i) => (
                  <option key={k} value={k}>
                    {CHOICE_LABEL[k]}
                    {i === 0 ? ' (detected)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <IconButton icon={FolderOpenIcon} label="Open another file (O)" onClick={onOpen}>
            <span className="max-sm:hidden">Open</span>
          </IconButton>
          <IconButton icon={KeyboardIcon} label="Keyboard shortcuts (?)" onClick={() => setHelp(true)} />
          <IconButton
            icon={fullscreen ? MinimizeScreenIcon : FullScreenIcon}
            label={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            onClick={onFullscreen}
          />
          <IconButton icon={Cancel01Icon} label="Close the file" onClick={onClose} />
        </div>
      </header>
      <div
        className={cn(
          'relative flex min-h-0 flex-col overflow-hidden bg-background',
          fullscreen ? 'flex-1' : 'h-[clamp(26rem,calc(100dvh-13rem),60rem)]',
        )}
      >
        {body}
      </div>
      {!fullscreen ? (
        <div className="border-t bg-card px-3 py-2.5 sm:px-4">
          <OpenWith files={files} sniff={sniffed} current={tool.slug} />
        </div>
      ) : null}

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>They work while you are not typing in a field.</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 text-sm">
            {[...shortcuts, ...FRAME_SHORTCUTS].map((s) => (
              <li key={`${s.keys}-${s.label}`} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="flex shrink-0 gap-1">
                  {s.keys.split(/\s{2,}/).map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </ViewerContext.Provider>
  );
}

/**
 * The shared frame of every viewer: drop, browse or paste a file; a header
 * with what the file really is (sniffed from its bytes), its size,
 * fullscreen, shortcuts and file switching; the viewer for its kind (loaded
 * on demand); and "Open with" links to every tool that takes it. Nothing is
 * uploaded and the file is never changed.
 */
export function ViewerFrame({
  tool,
  kinds,
  as,
  intro,
}: {
  tool: ToolInfo;
  /** The kinds this tool is about; files of other kinds get a pointer to the right viewer. */
  kinds: ViewKind[] | 'any';
  /** Show accepted text files (any file, for 'hex') with this viewer instead of the detected one. */
  as?: ViewKind;
  /** A line under the drop zone: what this viewer can do. */
  intro?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const open = useCallback((list: File[]) => {
    if (!list.length) return;
    setFiles(list);
    setIndex(0);
  }, []);

  // Files handed over from another page ("Open with", the home page drop).
  useEffect(() => {
    const handed = takeHandoff(tool.slug);
    if (handed?.length) queueMicrotask(() => open(handed));
  }, [tool.slug, open]);

  // Paste replaces the open file (the drop zone handles paste before one is open).
  useEffect(() => {
    if (!files.length) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"], .cm-editor')) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        open(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [files.length, open]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current && root.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => setFullscreen((v) => !v));
    else setFullscreen((v) => !v);
  }, []);

  const pick = useCallback(() => input.current?.click(), []);
  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setFiles([]);
    setIndex(0);
  }, []);

  const current = files[index];
  return (
    <div
      ref={root}
      onDragEnter={(e) => {
        if (!files.length || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (files.length && e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!files.length) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        open(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground',
        fullscreen && 'fixed inset-0 z-50 h-dvh w-screen rounded-none border-0',
      )}
    >
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={tool.accept.join(',')}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          open(picked);
        }}
      />
      {current ? (
        <FileView
          key={fileKey(current)}
          tool={tool}
          kinds={kinds}
          as={as}
          files={files}
          index={index}
          onIndex={setIndex}
          onOpen={pick}
          onClose={close}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
        />
      ) : (
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <Dropzone accept={tool.accept} multiple onFiles={open} className="py-16 sm:py-20" />
          <div className="flex flex-col gap-2 text-xs/relaxed text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
            {intro ? <p className="max-w-2xl">{intro}</p> : <span />}
            <p className="flex shrink-0 items-center gap-1.5">
              <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 text-primary" />
              Opened on this device. Nothing is uploaded or changed.
            </p>
          </div>
        </div>
      )}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-background/80 backdrop-blur-sm">
          <p className="rounded-xl border border-dashed border-primary bg-card px-6 py-4 text-sm font-medium text-foreground">
            Drop to open
          </p>
        </div>
      ) : null}
    </div>
  );
}
