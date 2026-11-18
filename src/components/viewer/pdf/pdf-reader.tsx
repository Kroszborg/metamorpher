'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useState } from 'react';
import type { ViewerProps } from '../context';
import { PdfView } from './pdf-view';

type Info = { pages: number; title?: string; author?: string; producer?: string; version?: string };

export default function PdfReader({ file }: ViewerProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const onLoaded = (doc: PDFDocumentProxy) => {
    doc.getMetadata().then(
      (m) => {
        const i = m.info as Record<string, unknown>;
        setInfo({
          pages: doc.numPages,
          title: typeof i.Title === 'string' ? i.Title : undefined,
          author: typeof i.Author === 'string' ? i.Author : undefined,
          producer: typeof i.Producer === 'string' ? i.Producer : undefined,
          version: typeof i.PDFFormatVersion === 'string' ? i.PDFFormatVersion : undefined,
        });
      },
      () => setInfo({ pages: doc.numPages }),
    );
  };
  return (
    <PdfView
      file={file}
      label={`Pages of ${file.name}`}
      onLoaded={onLoaded}
      footerExtra={
        info ? (
          <>
            <span className="tabular-nums">{info.pages.toLocaleString()} pages</span>
            {info.version ? <span>PDF {info.version}</span> : null}
            {info.title ? <span className="max-w-80 truncate">“{info.title}”</span> : null}
            {info.author ? <span className="max-w-60 truncate">by {info.author}</span> : null}
            {info.producer ? <span className="max-w-60 truncate max-md:hidden">made with {info.producer}</span> : null}
          </>
        ) : null
      }
    />
  );
}
