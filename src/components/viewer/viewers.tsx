'use client';

import { lazy } from 'react';
import type { ViewerProps } from './context';
import type { ViewKind } from './sniff';

// One code-split chunk per viewer, fetched the first time a file of that kind is opened.
const TableViewer = lazy(() => import('./table/table-viewer'));
const DataViewer = lazy(() => import('./data/data-viewer'));
const TextViewer = lazy(() => import('./text/text-viewer'));
const MarkdownViewer = lazy(() => import('./markdown/markdown-viewer'));
const HexViewer = lazy(() => import('./hex/hex-viewer'));
const PdfReader = lazy(() => import('./pdf/pdf-reader'));
const DocumentViewer = lazy(() => import('./document/document-viewer'));
const ImageViewer = lazy(() => import('./image/image-viewer'));
const MediaViewer = lazy(() => import('./media/media-viewer'));
const ArchiveViewer = lazy(() => import('./hex/hex-viewer'));
const FontViewer = lazy(() => import('./hex/hex-viewer'));
const SqliteViewer = lazy(() => import('./hex/hex-viewer'));
const SubtitleViewer = lazy(() => import('./text/text-viewer'));

/** The viewer for `kind`, loaded on demand (wrap in Suspense). */
export function KindViewer({ kind, ...props }: ViewerProps & { kind: ViewKind }) {
  switch (kind) {
    case 'table':
      return <TableViewer {...props} />;
    case 'data':
      return <DataViewer {...props} />;
    case 'text':
      return <TextViewer {...props} />;
    case 'markdown':
      return <MarkdownViewer {...props} />;
    case 'hex':
      return <HexViewer {...props} />;
    case 'pdf':
      return <PdfReader {...props} />;
    case 'document':
      return <DocumentViewer {...props} />;
    case 'image':
      return <ImageViewer {...props} />;
    case 'video':
    case 'audio':
      return <MediaViewer {...props} />;
    case 'archive':
      return <ArchiveViewer {...props} />;
    case 'font':
      return <FontViewer {...props} />;
    case 'sqlite':
      return <SqliteViewer {...props} />;
    case 'subtitle':
      return <SubtitleViewer {...props} />;
  }
}
