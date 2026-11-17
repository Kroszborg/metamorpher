'use client';

import { useState } from 'react';
import { SwitchRow } from '@/components/pdf-stage';
import { perFile, Workbench } from '@/components/workbench';
import { type FlattenSpec, pdfStamp } from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

const job = perFile<FlattenSpec>(async (input, spec, ctx) => {
  ctx.onProgress(0.1, 'Flattening');
  // Links count as annotations: with annotations off they always stay.
  const { blob } = await pdfStamp.flatten(input.file, { ...spec, keepLinks: spec.keepLinks || !spec.annotations }, ctx.signal);
  return { name: `${baseName(input.file.name)}-flattened.pdf`, blob };
});

const validate = (_files: unknown, s: FlattenSpec) =>
  s.forms || s.annotations || s.removeJavaScript ? null : 'Choose at least one thing to flatten or remove.';

export default function FlattenPdf({ tool }: ToolProps) {
  const [spec, setSpec] = useState<FlattenSpec>({
    forms: true,
    annotations: true,
    keepLinks: true,
    removeJavaScript: true,
  });
  const set = <K extends keyof FlattenSpec>(key: K, value: FlattenSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));

  return (
    <Workbench
      job={job}
      options={spec}
      accept={tool.accept}
      runLabel="Flatten"
      validate={validate}
      zipName="flattened.zip"
      optionsPanel={
        <>
          <SwitchRow
            id="fl-forms"
            label="Form fields"
            checked={spec.forms}
            onChange={(v) => set('forms', v)}
            hint="Field values become part of the page and can no longer be edited."
          />
          <SwitchRow
            id="fl-annots"
            label="Annotations"
            checked={spec.annotations}
            onChange={(v) => set('annotations', v)}
            hint="Comments, highlights, stamps and drawings are burned in. Pop-up notes are dropped."
          />
          {spec.annotations ? (
            <SwitchRow id="fl-links" label="Keep links clickable" checked={spec.keepLinks} onChange={(v) => set('keepLinks', v)} />
          ) : null}
          <SwitchRow
            id="fl-js"
            label="Remove JavaScript"
            checked={spec.removeJavaScript}
            onChange={(v) => set('removeJavaScript', v)}
            hint="Document, page, field and link scripts, and XFA form data."
          />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Page content stays vector: text remains selectable. Hidden annotations are removed without being drawn.
          </p>
        </>
      }
    />
  );
}
