'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function DocumentViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['document']}
      intro="Word documents and PowerPoint slides are laid out as pages; EPUB, FB2 and MOBI books open as a reader with their chapters, a text size and light, sepia or dark pages. Everything gets search, thumbnails and selectable text. Spreadsheets open in the CSV & spreadsheet viewer."
    />
  );
}
