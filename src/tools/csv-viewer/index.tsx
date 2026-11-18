'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function CsvViewer({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['table']}
      as="table"
      intro="CSV and TSV of any size (a million rows opens in seconds), Excel and OpenDocument workbooks with sheet tabs. Delimiter, quotes, encoding and header row are detected and can be changed. Sort by several columns, filter each column, search every cell, see column statistics, and export the filtered view as CSV, Excel or JSON."
    />
  );
}
