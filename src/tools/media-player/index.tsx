'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function MediaPlayerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['video', 'audio']}
      intro="Plays what the browser can directly; AVI, WMV, FLV, MPEG and other formats it cannot are turned into a playable copy on this device first (streams copied where possible; the software engine handles files up to 1 GB). Speed from 0.25× to 4×, loop and A–B loop, frame steps, subtitles from SRT, VTT or ASS files, volume up to 200%, a waveform and spectrum for audio, a playlist for several files, and frame screenshots."
    />
  );
}
