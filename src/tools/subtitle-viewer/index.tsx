'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function SubtitleViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['subtitle']}
      as="subtitle"
      intro="SRT, WebVTT and ASS/SSA subtitles as a list with times and durations. Lines faster than 20 characters a second, overlapping lines and broken timings are marked. Save a copy as SRT or VTT; to watch them with a video, drop both files into the media player."
    />
  );
}
