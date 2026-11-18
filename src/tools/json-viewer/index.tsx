'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function JsonViewer({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['data']}
      as="data"
      intro="JSON, NDJSON, YAML, TOML and XML as a tree you can expand, search and copy paths from (JSONPath, JavaScript, JSON Pointer). Switch to text to pretty-print or minify, see exactly where a file is broken, or convert it to JSON, YAML, XML or CSV. Files of 50 MB and more stay smooth."
    />
  );
}
