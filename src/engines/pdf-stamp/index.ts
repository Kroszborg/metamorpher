/**
 * Stamping engine for the Edit & Annotate tools: text and image stamps,
 * numbering, colour modes, flattening, metadata, overlays and forms.
 * Everything runs in one lazily started module worker (@cantoo/pdf-lib).
 *
 * Runs and previews use separate workers, so a preview never cancels a run.
 */
import { WorkerHost } from '../worker-host';
import type { PreviewRequest, StampWorkerApi } from './stamp.worker';
import type {
  FieldValue,
  FlattenSpec,
  FormInfo,
  InvertSpec,
  MetadataInfo,
  MetadataSpec,
  OverlayItem,
  PageSize,
  TextStampSpec,
  WatermarkSpec,
} from './types';

export type { PreviewRequest } from './stamp.worker';
export * from './types';
export { ENCRYPTED_MESSAGE } from './messages';
export * from './geometry';
export * from './text-format';

const runs = new WorkerHost<StampWorkerApi>(
  () => new Worker(new URL('./stamp.worker.ts', import.meta.url), { type: 'module' }),
);
const previews = new WorkerHost<StampWorkerApi>(
  () => new Worker(new URL('./stamp.worker.ts', import.meta.url), { type: 'module' }),
);

export const pdfStamp = {
  pageSizes: (file: Blob, signal?: AbortSignal): Promise<PageSize[]> =>
    previews.call((api) => api.pageSizes(file), signal),
  stampText: (file: Blob, spec: TextStampSpec, signal?: AbortSignal) =>
    runs.call((api) => api.stampText(file, spec), signal),
  watermark: (file: Blob, spec: WatermarkSpec, signal?: AbortSignal): Promise<Blob> =>
    runs.call((api) => api.watermark(file, spec), signal),
  invert: (file: Blob, spec: InvertSpec, signal?: AbortSignal): Promise<Blob> =>
    runs.call((api) => api.invert(file, spec), signal),
  flatten: (file: Blob, spec: FlattenSpec, signal?: AbortSignal) =>
    runs.call((api) => api.flatten(file, spec), signal),
  readMetadata: (file: Blob, signal?: AbortSignal): Promise<MetadataInfo> =>
    previews.call((api) => api.readMetadata(file), signal),
  writeMetadata: (file: Blob, spec: MetadataSpec, signal?: AbortSignal): Promise<Blob> =>
    runs.call((api) => api.writeMetadata(file, spec), signal),
  placeOverlays: (file: Blob, items: OverlayItem[], signal?: AbortSignal): Promise<Blob> =>
    runs.call((api) => api.placeOverlays(file, items), signal),
  readForm: (file: Blob, signal?: AbortSignal): Promise<FormInfo> =>
    previews.call((api) => api.readForm(file), signal),
  fillForm: (file: Blob, values: Record<string, FieldValue>, options: { flatten: boolean }, signal?: AbortSignal) =>
    runs.call((api) => api.fillForm(file, values, options), signal),
  /** One processed page as a standalone PDF. Not cancellable: callers drop stale results instead. */
  preview: (file: Blob, request: PreviewRequest, page: number): Promise<Blob> =>
    previews.call((api) => api.preview(file, request, page)),
};

export type PdfStamp = typeof pdfStamp;
