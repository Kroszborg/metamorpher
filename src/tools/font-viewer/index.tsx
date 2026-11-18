'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function FontViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['font']}
      intro="TrueType, OpenType, WOFF and WOFF2. Type your own sample and pick a size, browse every character the font maps (click one to copy it), and read its family, version, designer and licence. The font is used by this page only and is never installed."
    />
  );
}
