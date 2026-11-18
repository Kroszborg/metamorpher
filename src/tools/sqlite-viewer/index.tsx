'use client';

import { ViewerFrame } from '@/components/viewer/frame';
import type { ToolProps } from '@/tools/types';

export default function SqliteViewerTool({ tool }: ToolProps) {
  return (
    <ViewerFrame
      tool={tool}
      kinds={['sqlite']}
      intro="SQLite databases (.db, .sqlite, GeoPackage, MBTiles) opened read-only with SQLite compiled to WebAssembly. Browse tables and views page by page, sort by any column, read the schema, and run your own SELECT queries. The file is never changed."
    />
  );
}
