'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function HexViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds="any"
      as="hex"
      intro="Every byte of any file, of any size, read in small pieces on demand: offsets, hex and text columns, go to offset, search for bytes or text, and a data inspector for integers, floats and dates at the cursor."
    />
  );
}
