import type { ViewKind } from './sniff';

/** Each kind of view, the tool that is about it, and how to name it in messages. */
export const KIND_INFO: Record<ViewKind, { label: string; slug: string; noun: string }> = {
  table: { label: 'CSV & spreadsheet viewer', slug: 'csv-viewer', noun: 'a table or spreadsheet' },
  data: { label: 'JSON, YAML & XML viewer', slug: 'json-viewer', noun: 'structured data' },
  text: { label: 'Text & code viewer', slug: 'text-viewer', noun: 'a text file' },
  markdown: { label: 'Markdown viewer', slug: 'markdown-viewer', noun: 'a Markdown file' },
  hex: { label: 'Hex viewer', slug: 'hex-viewer', noun: 'a binary file' },
  pdf: { label: 'PDF reader', slug: 'pdf-reader', noun: 'a PDF' },
  document: { label: 'Document & e-book viewer', slug: 'document-viewer', noun: 'a document or e-book' },
  image: { label: 'Image viewer', slug: 'image-viewer', noun: 'an image' },
  video: { label: 'Media player', slug: 'media-player', noun: 'a video' },
  audio: { label: 'Media player', slug: 'media-player', noun: 'audio' },
  archive: { label: 'Archive viewer', slug: 'archive-viewer', noun: 'an archive' },
  font: { label: 'Font viewer', slug: 'font-viewer', noun: 'a font' },
  sqlite: { label: 'SQLite viewer', slug: 'sqlite-viewer', noun: 'a SQLite database' },
  subtitle: { label: 'Subtitle viewer', slug: 'subtitle-viewer', noun: 'subtitles' },
};

/** Slugs of every viewer tool (they take handed-off files themselves). */
export const VIEWER_SLUGS: readonly string[] = ['open-file', ...new Set(Object.values(KIND_INFO).map((k) => k.slug))];
