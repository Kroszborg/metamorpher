'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function PdfReaderTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['pdf']}
      intro="Continuous pages with selectable text, page thumbnails and bookmarks, search with every match highlighted, zoom and fit, rotation, a page jump and a presentation mode. Protected files ask for their password, which never leaves this device."
    />
  );
}
