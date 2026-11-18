'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function TextViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['text', 'markdown', 'data', 'table', 'subtitle']}
      as="text"
      intro="Plain text, logs and source code in 50+ languages, with highlighting, line numbers, wrapping, search and a choice of encodings. Files over 12 MB open in 4 MB parts, so even multi-gigabyte logs open at once."
    />
  );
}
