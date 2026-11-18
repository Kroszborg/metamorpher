'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function ImageViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['image']}
      intro="JPG, PNG, WebP, AVIF, HEIC, GIF, TIFF, BMP, ICO and SVG. Zoom with the wheel or a pinch, rotate and flip the view, check transparency, read camera details and GPS position, see the histogram, pick colours and step through animation frames. Open several images for a gallery (arrow keys) or to compare two."
    />
  );
}
