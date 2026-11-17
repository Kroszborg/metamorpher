'use client';

import { useMemo, useState } from 'react';
import { type DocJobOptions, DocToPdfTool, docToPdfJob, prepareDocx } from '@/components/doc-tools';
import { SwitchRow } from '@/components/pdf-stage';
import { NoteLine } from '@/components/pdf-tools';
import type { ToolProps } from '@/tools/types';

type Extra = { ownPage: boolean };

const job = docToPdfJob<Extra & DocJobOptions>(({ file }, o) => prepareDocx(file, { ownPage: o.ownPage }));

export default function WordToPdf({ tool }: ToolProps) {
  const [ownPage, setOwnPage] = useState(true);
  const extra = useMemo<Extra>(() => ({ ownPage }), [ownPage]);
  return (
    <DocToPdfTool
      accept={tool.accept}
      job={job}
      extra={extra}
      zipName="word-pdfs.zip"
      showPage={!ownPage}
      showTextSize={false}
      imageResources={false}
      setupDefaults={{ pageNumbers: false }}
      fields={
        <SwitchRow
          id="docx-page"
          label="Page size and margins from the document"
          checked={ownPage}
          onChange={setOwnPage}
        />
      }
      footer={
        <NoteLine
          note={{
            kind: 'info',
            text: 'Converted in your browser without Microsoft Word, so the layout is approximated: headings, text styles, highlights, lists, tab stops, tables, images, page breaks, headers and footers with page numbers (when the document keeps its own page size) and footnotes at the bottom of their page are kept. Text does not flow around floating pictures (they get their own line, or sit over the text as in Word when they do not wrap); text boxes are placed inline; comments, charts, SmartArt and vector EMF/WMF drawings are not drawn. Complex documents may differ from Word.',
          }}
        />
      }
    />
  );
}
