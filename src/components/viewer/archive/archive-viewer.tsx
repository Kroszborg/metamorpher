'use client';

import {
  ArrowRight01Icon,
  Cancel01Icon,
  Download04Icon,
  File01Icon,
  Folder01Icon,
  FolderOpenIcon,
  Search01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Component, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadBlob, formatBytes, mimeFor } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, PanelTitle, Toolbar, ViewerLoading, ViewerProblem } from '../bits';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { extOf, type Sniffed, sniffFile } from '../sniff';
import { useVirtualScroll } from '../virtual';
import { KindViewer } from '../viewers';
import { type Entry, type Listing, listArchive, PasswordNeeded, readEntry } from './formats';

const ROW_H = 30;
const PREVIEW_LIMIT = 256 * 1024 * 1024;
const SHORTCUTS: Shortcut[] = [
  { keys: '↑  ↓', label: 'Move through the list (list focused)' },
  { keys: '→  ←', label: 'Open or close a folder' },
  { keys: 'Enter', label: 'Preview the file, or open the folder' },
  { keys: 'D', label: 'Download the selected file' },
  { keys: '/', label: 'Search names' },
];

type Node = { name: string; path: string; dir: boolean; children: Node[]; entry: Entry | null; size: number; packed: number; files: number };
type Row = { node: Node; depth: number };
type SortKey = 'name' | 'size' | 'ratio' | 'date';

function buildTree(entries: Entry[]): Node {
  const root: Node = { name: '', path: '', dir: true, children: [], entry: null, size: 0, packed: 0, files: 0 };
  const dirs = new Map<string, Node>([['', root]]);
  const dirFor = (path: string): Node => {
    const have = dirs.get(path);
    if (have) return have;
    const cut = path.lastIndexOf('/', path.length - 2);
    const parent = dirFor(cut >= 0 ? path.slice(0, cut + 1) : '');
    const node: Node = { name: path.slice(cut + 1, -1), path, dir: true, children: [], entry: null, size: 0, packed: 0, files: 0 };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    const path = e.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!path) continue;
    if (e.dir) {
      dirFor(path.endsWith('/') ? path : `${path}/`).entry = e;
      continue;
    }
    const cut = path.lastIndexOf('/');
    const parent = dirFor(cut >= 0 ? path.slice(0, cut + 1) : '');
    parent.children.push({ name: path.slice(cut + 1), path, dir: false, children: [], entry: e, size: e.size, packed: e.packed, files: 1 });
  }
  const total = (n: Node) => {
    if (!n.dir) return;
    n.size = 0;
    n.packed = 0;
    n.files = 0;
    for (const c of n.children) {
      total(c);
      n.size += c.size;
      n.packed += c.packed;
      n.files += c.files;
    }
  };
  total(root);
  return root;
}

function sortNodes(list: Node[], key: SortKey, desc: boolean): Node[] {
  const sign = desc ? -1 : 1;
  const ratio = (n: Node) => (n.size ? n.packed / n.size : 1);
  return [...list].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let d = 0;
    if (key === 'size') d = a.size - b.size;
    else if (key === 'ratio') d = ratio(a) - ratio(b);
    else if (key === 'date') d = (a.entry?.modified?.getTime() ?? 0) - (b.entry?.modified?.getTime() ?? 0);
    if (d === 0) d = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return d * sign;
  });
}

class PreviewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <ViewerProblem title="This file could not be previewed">{this.state.error.message}</ViewerProblem> : this.props.children;
  }
}

function Preview({ file }: { file: File }) {
  const [sniff, setSniff] = useState<Sniffed | null>(null);
  useEffect(() => {
    let live = true;
    sniffFile(file).then((s) => live && setSniff(s), () => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  if (!sniff) return <ViewerLoading label="Reading…" />;
  const kind = sniff.unsupported ? 'hex' : sniff.kind === 'archive' ? 'hex' : sniff.kind;
  return (
    <PreviewBoundary key={file.name}>
      <Suspense fallback={<ViewerLoading label="Loading the viewer…" />}>
        <KindViewer kind={kind} file={file} sniff={sniff} files={[file]} index={0} onIndex={() => undefined} />
      </Suspense>
    </PreviewBoundary>
  );
}

export default function ArchiveViewer({ file, sniff }: ViewerProps) {
  useShortcuts(SHORTCUTS);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [open, setOpen] = useState<Set<string>>(new Set(['']));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<{ path: string; file: File | null; error: string | null } | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [askPassword, setAskPassword] = useState<{ wrong: boolean; then: Entry } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    listArchive(file, extOf(file.name) || sniff.ext, sniff.format, (f) => live && setProgress(f)).then(
      (l) => {
        if (!live) return;
        setListing(l);
        // Open a single top folder straight away.
        const tops = new Set(l.entries.map((e) => e.path.split('/')[0]));
        if (tops.size === 1) setOpen(new Set(['', `${[...tops][0]}/`]));
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'This archive could not be read.'),
    );
    return () => {
      live = false;
    };
  }, [file, sniff.ext, sniff.format]);

  const tree = useMemo(() => (listing ? buildTree(listing.entries) : null), [listing]);

  const rows = useMemo<Row[]>(() => {
    if (!tree) return [];
    const out: Row[] = [];
    const q = query.trim().toLowerCase();
    if (q) {
      const walk = (n: Node) => {
        for (const c of n.children) {
          if (!c.dir && c.path.toLowerCase().includes(q)) out.push({ node: c, depth: 0 });
          if (c.dir) walk(c);
        }
      };
      walk(tree);
      return sortNodes(out.map((r) => r.node), sort.key, sort.desc).map((node) => ({ node, depth: 0 }));
    }
    const walk = (n: Node, depth: number) => {
      for (const c of sortNodes(n.children, sort.key, sort.desc)) {
        out.push({ node: c, depth });
        if (c.dir && open.has(c.path)) walk(c, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, open, query, sort]);

  const vs = useVirtualScroll(scroller, rows.length * ROW_H);

  const extract = useCallback(
    async (entry: Entry, pass = password): Promise<Uint8Array | null> => {
      try {
        return await readEntry(file, entry, pass ?? undefined);
      } catch (err) {
        if (err instanceof PasswordNeeded) {
          setAskPassword({ wrong: err.wrong, then: entry });
          return null;
        }
        throw err;
      }
    },
    [file, password],
  );

  const show = useCallback(
    async (node: Node, pass?: string) => {
      if (node.dir || !node.entry) return;
      if (node.size > PREVIEW_LIMIT) {
        setPreview({ path: node.path, file: null, error: `This file is ${formatBytes(node.size)}; files up to ${formatBytes(PREVIEW_LIMIT)} are previewed. Download it instead.` });
        return;
      }
      setPreview({ path: node.path, file: null, error: null });
      try {
        const data = await extract(node.entry, pass ?? password);
        if (!data) {
          setPreview(null);
          return;
        }
        setPreview({ path: node.path, file: new File([data as Uint8Array<ArrayBuffer>], node.name, { type: mimeFor(extOf(node.name)) }), error: null });
      } catch (err) {
        setPreview({ path: node.path, file: null, error: err instanceof Error ? err.message : 'This file could not be read.' });
      }
    },
    [extract, password],
  );

  const download = useCallback(
    async (node: Node) => {
      if (!node.entry || node.dir) return;
      try {
        const data = await extract(node.entry);
        if (data) downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFor(extOf(node.name)) }), node.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'This file could not be extracted.');
      }
    },
    [extract],
  );

  /** Every file: into a folder the person picks (where the browser allows it), else as one ZIP download. */
  const extractAll = useCallback(async () => {
    if (!listing) return;
    const files = listing.entries.filter((e) => !e.dir);
    const picker = (window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    try {
      if (picker) {
        let root: FileSystemDirectoryHandle;
        try {
          root = await picker({ mode: 'readwrite' });
        } catch {
          return;
        }
        let done = 0;
        for (const e of files) {
          setBusy(`Extracting ${++done} of ${files.length}`);
          const data = await extract(e);
          if (!data) return;
          const parts = e.path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '..' && p !== '.');
          let dir = root;
          for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
          const handle = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
          const w = await handle.createWritable();
          await w.write(data as Uint8Array<ArrayBuffer>);
          await w.close();
        }
        toast.success(`Extracted ${files.length.toLocaleString()} files`);
      } else {
        const { ZipWriter } = await import('@/engines/archive');
        const zip = new ZipWriter();
        let done = 0;
        for (const e of files) {
          setBusy(`Packing ${++done} of ${files.length}`);
          const data = await extract(e);
          if (!data) return;
          await zip.add(e.path, new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFor(extOf(e.path)) }));
        }
        downloadBlob(zip.finish(), `${file.name.replace(/\.(zip|tar|tgz|tar\.gz|gz)$/i, '')}-files.zip`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setBusy(null);
    }
  }, [listing, extract, file.name]);

  const toggle = (node: Node, want?: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      if (want ?? !next.has(node.path)) next.add(node.path);
      else next.delete(node.path);
      return next;
    });

  const select = (i: number) => {
    const p = Math.max(0, Math.min(rows.length - 1, i));
    setCursor(p);
    const y = p * ROW_H;
    if (y < vs.top) vs.scrollTo(y);
    else if (y + ROW_H > vs.top + vs.height) vs.scrollTo(y + ROW_H - vs.height);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const row = rows[cursor];
    switch (e.key) {
      case 'ArrowDown':
        select(cursor + 1);
        break;
      case 'ArrowUp':
        select(cursor - 1);
        break;
      case 'PageDown':
        select(cursor + Math.floor(vs.height / ROW_H));
        break;
      case 'PageUp':
        select(cursor - Math.floor(vs.height / ROW_H));
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row?.node.dir) toggle(row.node, true);
        break;
      case 'ArrowLeft':
        if (row?.node.dir && open.has(row.node.path)) toggle(row.node, false);
        break;
      case 'Enter':
        if (row) {
          if (row.node.dir) toggle(row.node);
          else void show(row.node);
        }
        break;
      case 'd':
      case 'D':
        if (row) void download(row.node);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  useKeys(
    useCallback((e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey) {
        search.current?.focus();
        return true;
      }
      return false;
    }, []),
  );

  if (error) {
    return (
      <ViewerProblem title="This archive could not be opened">
        {error} {sniff.format.startsWith('ZIP') ? 'A damaged ZIP sometimes still opens in a desktop archive tool that repairs it.' : ''}
      </ViewerProblem>
    );
  }
  if (!listing || !tree) return <ViewerLoading label={progress !== undefined ? 'Unpacking…' : 'Reading the archive…'} progress={progress} />;

  const ratio = (n: Node) => (n.size > 0 ? `${Math.round((1 - n.packed / n.size) * 100)}%` : '—');
  const head = (key: SortKey, label: string, cls: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}
      className={cn('truncate text-left text-xs font-semibold outline-none hover:text-foreground focus-visible:underline', sort.key === key ? 'text-foreground' : 'text-muted-foreground', cls)}
      aria-pressed={sort.key === key}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </button>
  );
  const encryptedCount = listing.entries.filter((e) => e.encrypted !== 'none').length;
  const files = tree.files;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder={`Search ${files.toLocaleString()} files`}
            aria-label="Search file names"
            className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        {query ? <span className="text-xs text-muted-foreground tabular-nums">{rows.length.toLocaleString()} found</span> : null}
        <ChipButton onClick={() => setOpen(new Set(['', ...listing.entries.flatMap((e) => e.path.split('/').slice(0, -1).map((_, i, a) => `${a.slice(0, i + 1).join('/')}/`))]))}>Expand all</ChipButton>
        <ChipButton onClick={() => setOpen(new Set(['']))}>Collapse</ChipButton>
        <span className="flex-1" />
        <ChipButton onClick={() => void extractAll()} disabled={!!busy} className="border">
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
          {busy ?? 'Extract all'}
        </ChipButton>
      </Toolbar>
      <div className="relative flex min-h-0 flex-1 max-lg:flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_3.5rem] gap-2 border-b bg-card px-3 py-1.5 max-sm:grid-cols-[minmax(0,1fr)_5rem] lg:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_3.5rem_8.5rem]">
            {head('name', 'Name', '')}
            {head('size', 'Size', 'text-right')}
            {head('size', 'Packed', 'text-right max-sm:hidden')}
            {head('ratio', 'Saved', 'text-right max-sm:hidden')}
            {head('date', 'Modified', 'max-lg:hidden')}
          </div>
          <div
            ref={scroller}
            tabIndex={0}
            role="tree"
            aria-label={`Files in ${file.name}`}
            onKeyDown={onListKey}
            className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
          >
            <div style={{ height: vs.spacer }} className="relative">
              {rows.slice(Math.max(0, Math.floor(vs.top / ROW_H) - 4), Math.ceil((vs.top + vs.height) / ROW_H) + 4).map((r, k) => {
                const i = Math.max(0, Math.floor(vs.top / ROW_H) - 4) + k;
                const n = r.node;
                const isOpen = n.dir && open.has(n.path);
                return (
                  <div
                    key={n.path}
                    role="treeitem"
                    aria-level={r.depth + 1}
                    aria-expanded={n.dir ? isOpen : undefined}
                    aria-selected={i === cursor}
                    onClick={() => {
                      setCursor(i);
                      if (n.dir) toggle(n);
                      else void show(n);
                    }}
                    className={cn(
                      'absolute inset-x-0 grid cursor-default grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_3.5rem] items-center gap-2 px-3 text-xs max-sm:grid-cols-[minmax(0,1fr)_5rem] lg:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_3.5rem_8.5rem]',
                      i === cursor ? 'bg-primary/12 ring-1 ring-primary/40 ring-inset' : 'hover:bg-muted/60',
                      preview?.path === n.path && 'font-medium',
                    )}
                    style={{ top: i * ROW_H + vs.shift, height: ROW_H }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: r.depth * 16 }}>
                      {n.dir ? (
                        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2.4} className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <HugeiconsIcon icon={n.dir ? (isOpen ? FolderOpenIcon : Folder01Icon) : File01Icon} strokeWidth={1.9} className={cn('size-4 shrink-0', n.dir ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 truncate" title={n.path}>
                        {query ? n.path : n.name}
                      </span>
                      {n.entry && n.entry.encrypted !== 'none' ? <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0 text-warning" /> : null}
                      {n.dir ? <span className="shrink-0 text-faint">{n.files.toLocaleString()}</span> : null}
                    </span>
                    <span className="text-right text-muted-foreground tabular-nums">{formatBytes(n.size)}</span>
                    <span className="text-right text-muted-foreground tabular-nums max-sm:hidden">{formatBytes(n.packed)}</span>
                    <span className="text-right text-muted-foreground tabular-nums max-sm:hidden">{ratio(n)}</span>
                    <span className="truncate text-muted-foreground tabular-nums max-lg:hidden">{n.entry?.modified ? n.entry.modified.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {preview ? (
          <aside data-viewer-panel aria-label="Preview" className="flex min-h-0 flex-col border-l bg-card max-lg:h-[55%] max-lg:border-t max-lg:border-l-0 lg:w-[46%]">
            <PanelTitle
              action={
                <span className="flex items-center gap-1">
                  {preview.file ? (
                    <IconButton
                      icon={Download04Icon}
                      label="Download this file"
                      className="h-7 min-w-7"
                      onClick={() => preview.file && downloadBlob(preview.file, preview.file.name)}
                    />
                  ) : null}
                  <IconButton icon={Cancel01Icon} label="Close the preview" className="h-7 min-w-7" onClick={() => setPreview(null)} />
                </span>
              }
            >
              <span className="normal-case">{preview.path.split('/').pop()}</span>
            </PanelTitle>
            <div className="relative flex min-h-0 flex-1 flex-col bg-background">
              {preview.error ? (
                <ViewerProblem title="No preview">{preview.error}</ViewerProblem>
              ) : preview.file ? (
                <Preview file={preview.file} />
              ) : (
                <ViewerLoading label="Extracting…" />
              )}
            </div>
          </aside>
        ) : null}
        {askPassword ? (
          <div className="absolute inset-0 z-30 grid place-items-center bg-background/90 p-6">
            <form
              className="flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-card p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const entry = askPassword.then;
                setPassword(pw);
                setAskPassword(null);
                const node: Node = { name: entry.path.split('/').pop() ?? entry.path, path: entry.path, dir: false, children: [], entry, size: entry.size, packed: entry.packed, files: 1 };
                void show(node, pw);
              }}
            >
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-5 text-primary" />
                <p className="text-sm font-semibold">This archive is protected</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {askPassword.wrong ? 'That password is not right. Try again.' : 'Enter its password. It stays on this device.'}
              </p>
              <input
                type="password"
                autoFocus
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                aria-label="Archive password"
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="flex gap-2">
                <Button type="submit" size="lg" disabled={!pw} className="flex-1">
                  Unlock
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => setAskPassword(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{listing.format}</span>
        <span className="tabular-nums">
          {files.toLocaleString()} file{files === 1 ? '' : 's'} · {formatBytes(tree.size)} unpacked · {formatBytes(file.size)} packed
        </span>
        {encryptedCount ? <span className="text-warning">{encryptedCount.toLocaleString()} protected with a password</span> : null}
        {listing.comment ? <span className="max-w-96 truncate">Comment: {listing.comment}</span> : null}
      </footer>
    </div>
  );
}
