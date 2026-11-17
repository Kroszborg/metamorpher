import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { NupOptions, PageOpsWorkerApi, PageSpec, PdfInfo, SizePart } from './page-ops.worker';

export type {
  NupOptions,
  OutlineEntry,
  PageMargins,
  PageSpec,
  PdfInfo,
  SizePart,
} from './page-ops.worker';

const host = new WorkerHost<PageOpsWorkerApi>(
  () => new Worker(new URL('./page-ops.worker.ts', import.meta.url), { type: 'module' }),
);

type NamedBlob = { name: string; blob: Blob };
type CallOptions = { signal?: AbortSignal; onProgress?: (done: number, total: number) => void };

/**
 * Page-level operations (pdf-lib, in their own worker). Page content is copied
 * byte for byte or wrapped in a transformation, never rasterised.
 *
 * - `rewrite` changes one file in place: order, duplicates, deletions and
 *   per-page transforms, keeping forms, tags, layers and attachments.
 * - `assemble` builds new files from pages of one or more files (split,
 *   extract, mix), keeping bookmarks and internal links within each output.
 */
export const pageOps = {
  /** Page count and flattened bookmarks. Rejects with a readable message for encrypted or broken files. */
  inspect(file: NamedBlob, { signal }: CallOptions = {}): Promise<PdfInfo> {
    return host.call((api) => api.inspect(file), signal);
  },

  rewrite(file: NamedBlob, pages: PageSpec[], { signal }: CallOptions = {}): Promise<Blob> {
    return host.call((api) => api.rewrite(file, pages), signal);
  },

  assemble(
    files: NamedBlob[],
    groups: PageSpec[][],
    { signal, onProgress, outline = true }: CallOptions & { outline?: boolean } = {},
  ): Promise<Blob[]> {
    return host.call(
      (api) => api.assemble(files, groups, { outline }, onProgress && proxy(onProgress)),
      signal,
    );
  },

  splitBySize(file: NamedBlob, maxBytes: number, { signal, onProgress }: CallOptions = {}): Promise<SizePart[]> {
    return host.call((api) => api.splitBySize(file, maxBytes, onProgress && proxy(onProgress)), signal);
  },

  nup(file: NamedBlob, options: NupOptions, { signal, onProgress }: CallOptions = {}): Promise<Blob> {
    return host.call((api) => api.nup(file, options, onProgress && proxy(onProgress)), signal);
  },
};

export type PageOps = typeof pageOps;
