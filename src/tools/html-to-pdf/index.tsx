'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { NoteLine } from '@/components/pdf-tools';
import { BODY_SIZE, type DocJobOptions, DocToPdfTool, docToPdfJob, prepareHtmlFile } from '@/components/doc-tools';
import { OptionField } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Styles = 'page' | 'clean';
type Extra = { styles: Styles };

const job = docToPdfJob<Extra & DocJobOptions>(({ file }, o) =>
  prepareHtmlFile(file, { resources: o.resources, fontSize: BODY_SIZE[o.setup.textSize], keepStyles: o.styles === 'page' }),
);

export default function HtmlToPdf({ tool }: ToolProps) {
  const [styles, setStyles] = useState<Styles>('page');
  const extra = useMemo<Extra>(() => ({ styles }), [styles]);
  return (
    <DocToPdfTool
      accept={[...tool.accept, 'image/*', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']}
      job={job}
      extra={extra}
      zipName="html-pdfs.zip"
      paste={{ fileName: 'page.html', type: 'text/html', placeholder: '<h1>Title</h1>\n<p>Paste HTML here.</p>' }}
      fields={
        <OptionField
          label="Styles"
          hint={
            styles === 'page'
              ? "Uses the page's own CSS (<style> and style attributes) on top of a clean base."
              : 'Ignores the page’s CSS and sets everything in the clean document style.'
          }
        >
          <Segmented<Styles>
            label="Styles"
            value={styles}
            options={[
              { value: 'page', label: "Page's styles" },
              { value: 'clean', label: 'Clean' },
            ]}
            onChange={setStyles}
          />
        </OptionField>
      }
      footer={
        <NoteLine
          note={{
            kind: 'info',
            text: 'Nothing is downloaded: scripts do not run, and images, stylesheets and fonts on the web are left out. Add local image files next to the page (matched by name). Layout follows print CSS basics; flexbox, grid and positioned layouts are flattened.',
          }}
        />
      }
    />
  );
}
