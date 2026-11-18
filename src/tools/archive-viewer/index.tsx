'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function ArchiveViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['archive']}
      intro="ZIP (also JAR, APK, CBZ and other ZIP-based files), TAR and GZ / TAR.GZ. Only the ZIP directory is read to list it, so large archives open at once. Preview any file inside in the matching viewer, download one, or extract everything into a folder. Password-protected ZIPs (classic encryption) ask for the password. 7z and RAR cannot be opened here."
    />
  );
}
