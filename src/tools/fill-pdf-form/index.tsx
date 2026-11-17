'use client';

import { Delete02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/kit/section-card';
import { PdfStage, type StageView, SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Dropzone, perFile, Results, RunBar, useWorkbench } from '@/components/workbench';
import { type Box, type FieldValue, type FormField, type FormInfo, pdfStamp } from '@/engines/pdf-stamp';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { FieldInput } from './field-input';

type Values = Record<string, FieldValue>;

const same = (a: FieldValue | undefined, b: FieldValue | undefined) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;
type Edits = { fileId: string; values: Values };
type Options = { edits: Edits | null; flatten: boolean };

const job = perFile<Options>(async (input, options, ctx) => {
  // Only fields the user changed are written, so untouched fields keep their original appearance.
  const changes: Values = {};
  if (options.edits?.fileId === input.id) {
    const info = await pdfStamp.readForm(input.file, ctx.signal);
    for (const f of info.fields) {
      const v = options.edits.values[f.name];
      if (v !== undefined && !same(v, f.value)) changes[f.name] = v;
    }
  }
  ctx.onProgress(0.2, options.flatten ? 'Filling and flattening' : 'Filling');
  const { blob, unencodable } = await pdfStamp.fillForm(input.file, changes, { flatten: options.flatten }, ctx.signal);
  if (unencodable.length) {
    toast.warning(
      `${unencodable.length === 1 ? 'One field uses' : `${unencodable.length} fields use`} characters outside the standard form font. PDF readers will draw ${unencodable.length === 1 ? 'it' : 'them'} when the file is opened.`,
    );
  }
  return { name: `${baseName(input.file.name)}-filled.pdf`, blob };
});

const FILLABLE = new Set(['text', 'checkbox', 'radio', 'dropdown', 'list']);

/** Where a widget sits on screen; rotated with the page so its text runs the way the page draws it. */
function widgetStyle(view: StageView, rect: Box): CSSProperties {
  const [x1, y1] = view.toView(rect.x, rect.y);
  const [x2, y2] = view.toView(rect.x + rect.width, rect.y + rect.height);
  const w = rect.width * view.scale;
  const h = rect.height * view.scale;
  const rotation = view.frame.rotation;
  return {
    position: 'absolute',
    left: (x1 + x2) / 2 - w / 2,
    top: (y1 + y2) / 2 - h / 2,
    width: w,
    height: h,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };
}

export default function FillPdfForm({ tool }: ToolProps) {
  const [edits, setEdits] = useState<Edits | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [form, setForm] = useState<{ fileId: string; info: FormInfo | null; error: string | null } | null>(null);
  const [pageState, setPageState] = useState<{ fileId: string | null; page: number }>({ fileId: null, page: 0 });

  // The workbench needs options before it knows the file, so the edits carry their file id.
  const options = useMemo<Options>(() => ({ edits, flatten }), [edits, flatten]);
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;
  const fileId = input?.id ?? null;
  const page = pageState.fileId === fileId ? pageState.page : 0;

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    pdfStamp.readForm(input.file).then(
      (info) => {
        if (!cancelled) setForm({ fileId: input.id, info, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setForm({ fileId: input.id, info: null, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input]);

  const info = form?.fileId === fileId ? form.info : null;
  const readError = form?.fileId === fileId ? form.error : null;
  const fields = useMemo(() => (info?.fields ?? []).filter((f) => FILLABLE.has(f.type)), [info]);
  const original = useMemo(() => Object.fromEntries(fields.map((f) => [f.name, f.value])) as Values, [fields]);
  const values: Values = edits?.fileId === fileId ? edits.values : original;

  const changedCount = fields.filter((f) => !same(values[f.name], original[f.name])).length;

  const setValue = (name: string, value: FieldValue) => {
    if (fileId) setEdits({ fileId, values: { ...values, [name]: value } });
  };

  const byPage = useMemo(() => {
    const map = new Map<number, FormField[]>();
    for (const f of fields) {
      const first = f.widgets[0]?.page ?? -1;
      map.set(first, [...(map.get(first) ?? []), f]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [fields]);

  const reset = () => {
    wb.reset();
    setEdits(null);
  };

  const disabledReason = !input
    ? 'Add a PDF form to start.'
    : readError
      ? readError
      : !info
        ? 'Reading the form…'
        : fields.length === 0
          ? info.xfaOnly
            ? 'This is an XFA form, which only Adobe readers can fill. It has no standard form fields.'
            : 'This PDF has no fillable form fields.'
          : changedCount === 0 && !flatten
            ? 'Fill in at least one field.'
            : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title="Form"
          description={
            input
              ? `${input.file.name}${info ? ` · ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}` : ''}`
              : 'Files stay on this device. Nothing is uploaded.'
          }
          action={
            input ? (
              <Button variant="ghost" size="sm" onClick={reset} disabled={wb.running}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Clear
              </Button>
            ) : null
          }
          contentClassName="flex flex-col gap-2 p-3"
        >
          {input ? (
            <PdfStage
              file={input.file}
              page={page}
              onPageChange={(p) => setPageState({ fileId, page: p })}
              formFields="hide"
              error={readError}
              overlay={(view) => (
                <fieldset disabled={wb.running} className="contents">
                  {fields.flatMap((f) =>
                    f.widgets
                      .filter((w) => w.page === page)
                      .map((w, i) => {
                        const style = widgetStyle(view, w.rect);
                        const h = w.rect.height * view.scale;
                        const fontSize = Math.max(7, Math.min(f.multiline ? 11 * view.scale : h * 0.62, 14 * view.scale));
                        return (
                          <div key={`${f.name}-${i}`} style={style}>
                            <FieldInput
                              field={f}
                              value={values[f.name] ?? ''}
                              option={f.type === 'radio' ? w.option : undefined}
                              onChange={(v) => setValue(f.name, v)}
                              variant="page"
                              fontSize={fontSize}
                            />
                          </div>
                        );
                      }),
                  )}
                </fieldset>
              )}
            />
          ) : (
            <Dropzone accept={tool.accept} multiple={false} disabled={wb.running} onFiles={wb.addFiles} />
          )}
        </SectionCard>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          {fields.length > 0 ? (
            <SectionCard
              title="Fields"
              description={changedCount ? `${changedCount} changed` : 'Fill in on the page or here.'}
              contentClassName="flex max-h-[50vh] flex-col gap-4 overflow-y-auto"
            >
              <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
                {byPage.map(([p, list]) => (
                  <div key={p} className="flex flex-col gap-2.5">
                    <button
                      type="button"
                      className="w-fit text-[0.7rem] font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => p >= 0 && setPageState({ fileId, page: p })}
                    >
                      {p >= 0 ? `Page ${p + 1}` : 'Not on a page'}
                    </button>
                    {list.map((f) => (
                      <div key={f.name} className="flex flex-col gap-1">
                        <label htmlFor={`ff-${f.name}`} className="truncate text-xs font-medium" title={f.name}>
                          {f.name}
                          {f.readOnly ? <span className="font-normal text-muted-foreground"> · read-only</span> : null}
                        </label>
                        <FieldInput
                          id={`ff-${f.name}`}
                          field={f}
                          value={values[f.name] ?? ''}
                          onChange={(v) => setValue(f.name, v)}
                          variant="list"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </fieldset>
            </SectionCard>
          ) : null}
          <SectionCard title="Options" contentClassName="flex flex-col gap-4">
            <fieldset disabled={wb.running} className="flex min-w-0 flex-col gap-4">
              <SwitchRow
                id="ff-flatten"
                label="Flatten after filling"
                checked={flatten}
                onChange={setFlatten}
                hint={
                  flatten
                    ? 'Values become part of the page and the fields are removed, so nobody can change them.'
                    : 'The fields stay editable in any PDF reader.'
                }
              />
            </fieldset>
          </SectionCard>
          <RunBar
            label="Save filled PDF"
            running={wb.running}
            progress={wb.progress}
            note={wb.note}
            disabledReason={disabledReason}
            onRun={wb.run}
            onCancel={wb.cancel}
          />
          <p className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            Processed in your browser. Your files never leave this device.
          </p>
        </div>
      </div>
      <Results results={wb.results} />
    </div>
  );
}
