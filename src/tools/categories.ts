import {
  AiBrain01Icon,
  Briefcase01Icon,
  Files02Icon,
  FileExportIcon,
  FileImportIcon,
  FileViewIcon,
  Image01Icon,
  PencilEdit02Icon,
  SecurityCheckIcon,
  Share08Icon,
  Video01Icon,
  WorkflowSquare03Icon,
} from '@hugeicons/core-free-icons';
import type { Category, CategoryId } from './types';

/** Display order of categories in the rail, the dashboard pills and the palette. */
export const CATEGORIES: readonly Category[] = [
  {
    id: 'page-management',
    title: 'Page management',
    description: 'Merge, split, reorder, rotate and compress PDF pages.',
    icon: Files02Icon,
  },
  {
    id: 'edit-annotate',
    title: 'Edit & annotate',
    description: 'Add text, signatures, watermarks and page numbers to PDFs.',
    icon: PencilEdit02Icon,
  },
  {
    id: 'convert-to-pdf',
    title: 'Convert to PDF',
    description: 'Turn images, documents and web pages into PDF files.',
    icon: FileImportIcon,
  },
  {
    id: 'convert-from-pdf',
    title: 'Convert from PDF',
    description: 'Turn PDF pages into images, text and office documents.',
    icon: FileExportIcon,
  },
  {
    id: 'security',
    title: 'Security & privacy',
    description: 'Encrypt, unlock, redact and inspect files.',
    icon: SecurityCheckIcon,
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Convert, compress, resize and clean up images.',
    icon: Image01Icon,
  },
  {
    id: 'media',
    title: 'Audio & video',
    description: 'Convert, trim and extract audio and video.',
    icon: Video01Icon,
  },
  {
    id: 'view',
    title: 'View & play',
    description: 'Open any file to read, browse or play it: tables, data, code, PDFs, documents, images, audio, video and archives.',
    icon: FileViewIcon,
  },
  {
    id: 'ai',
    title: 'AI (on-device)',
    description: 'OCR, summaries and transcription that run on your device.',
    icon: AiBrain01Icon,
  },
  {
    id: 'workflow',
    title: 'Scan & workflow',
    description: 'Scan with your camera and chain operations together.',
    icon: WorkflowSquare03Icon,
  },
  {
    id: 'business',
    title: 'Business & everyday',
    description: 'Invoices, receipts, résumés, QR codes, handwriting and a whiteboard.',
    icon: Briefcase01Icon,
  },
  {
    id: 'share',
    title: 'Share',
    description: 'Send files directly between devices.',
    icon: Share08Icon,
  },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return byId.get(id as CategoryId);
}
