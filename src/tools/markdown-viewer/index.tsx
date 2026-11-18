'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function MarkdownViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['markdown']}
      as="markdown"
      intro="Read Markdown as a formatted page with an outline of its headings, or side by side with the source. Tables, task lists and front matter are shown; scripts and remote images never load, so opening a file sends nothing anywhere."
    />
  );
}
