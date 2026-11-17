'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function OpenFile({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds="any"
      intro="Drop any file: tables, JSON, code, Markdown, PDFs, Word, PowerPoint and e-books, images, audio and video, ZIP archives, fonts and databases. The type is read from the file's content, not just its name. Anything else opens as text or bytes."
    />
  );
}
