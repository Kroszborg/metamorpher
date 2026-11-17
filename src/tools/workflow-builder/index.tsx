'use client';

import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field, SelectField } from '@/components/business/form-bits';
import { NumberInput } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { defineJob, type InputFile, type JobContext, type OutputFile, Workbench } from '@/components/workbench';
import { newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { fits, type Kind, kindAfter, type Options, type PipelineStep, STEPS, stepById } from './steps';

type StepUse = { key: string; id: string; options: Options };
type Pipeline = { start: Kind; steps: StepUse[] };
type Saved = { name: string; start: Kind; steps: { id: string; options: Options }[] };

const SAVED_KEY = 'metamorpher:workflows';

const use = (id: string, options: Options = {}): StepUse => {
  const s = stepById(id) as PipelineStep;
  return { key: newId('st'), id, options: { ...s.defaults, ...options } };
};

const RECIPES: { name: string; hint: string; start: Kind; steps: [string, Options?][] }[] = [
  { name: 'Scans → secure PDF', hint: 'Images to one PDF, compressed, stamped CONFIDENTIAL and password-protected.', start: 'image', steps: [['images-to-pdf'], ['compress'], ['watermark'], ['encrypt']] },
  { name: 'Merge, number, compress', hint: 'One tidy PDF from several.', start: 'pdf', steps: [['merge'], ['page-numbers'], ['compress']] },
  { name: 'Shrink and protect PDFs', hint: 'Each PDF compressed and encrypted.', start: 'pdf', steps: [['compress', { preset: 'strong' }], ['encrypt']] },
  { name: 'Stamp DRAFT', hint: 'Diagonal DRAFT on every page.', start: 'pdf', steps: [['watermark', { text: 'DRAFT', color: '#1f4e79' }]] },
  { name: 'Photos for the web', hint: 'Longest side 1600 px, WebP, in a ZIP.', start: 'image', steps: [['resize-image'], ['convert-image'], ['zip', { name: 'web-photos' }]] },
];

/** Strips secret fields before saving. */
function savable(p: Pipeline, name: string): Saved {
  return {
    name,
    start: p.start,
    steps: p.steps.map((s) => {
      const step = stepById(s.id) as PipelineStep;
      const options = { ...s.options };
      for (const f of step.fields) if (f.type === 'text' && f.secret) options[f.key] = '';
      return { id: s.id, options };
    }),
  };
}

function loadSaved(): Saved[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as Saved[]).filter((s) => s && typeof s.name === 'string' && Array.isArray(s.steps) && s.steps.every((x) => stepById(x.id))) : [];
  } catch {
    return [];
  }
}

/** The whole pipeline as one workbench job: each step's outputs are the next step's inputs. */
const pipelineJob = defineJob<Pipeline>({
  mode: 'batch',
  async run(inputs, p, ctx) {
    let files: InputFile[] = inputs;
    let last: OutputFile[] = [];
    const n = p.steps.length;
    for (let k = 0; k < n; k++) {
      const use = p.steps[k] as StepUse;
      const step = stepById(use.id) as PipelineStep;
      const note = `Step ${k + 1} of ${n}: ${step.title}`;
      const sub: JobContext = { ...ctx, onProgress: (f, extra) => ctx.onProgress((k + Math.min(1, f)) / n, extra ? `${note} · ${extra}` : note) };
      sub.onProgress(0);
      if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      last = await step.job.run(files, use.options, sub);
      files = last.map((o) => ({ id: newId('wf'), file: new File([o.blob], o.name, { type: o.blob.type }) }));
    }
    return last.map(({ name, blob }) => ({ name, blob }));
  },
});

function StepFields({ step, use: u, prefix, onChange }: { step: PipelineStep; use: StepUse; prefix: string; onChange: (o: Options) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {step.fields.map((f) => {
        const id = `${prefix}-${f.key}`;
        if (f.type === 'select')
          return <SelectField key={f.key} label={f.label} value={String(u.options[f.key])} options={f.options} onChange={(v) => onChange({ ...u.options, [f.key]: v })} />;
        if (f.type === 'number')
          return (
            <Field key={f.key} label={f.label} htmlFor={id}>
              <NumberInput id={id} value={Number(u.options[f.key])} min={f.min} max={f.max} step={f.step ?? 1} suffix={f.suffix} onChange={(v) => onChange({ ...u.options, [f.key]: v })} />
            </Field>
          );
        return (
          <Field key={f.key} label={f.label} htmlFor={id}>
            <Input id={id} type={f.secret ? 'password' : 'text'} autoComplete="off" value={String(u.options[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => onChange({ ...u.options, [f.key]: e.currentTarget.value })} />
          </Field>
        );
      })}
    </div>
  );
}

export default function WorkflowBuilder(_props: ToolProps) {
  const [pipeline, setPipeline] = useState<Pipeline>({ start: 'image', steps: RECIPES[0]!.steps.map(([id, o]) => use(id, o)) });
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState('My workflow');
  const [adding, setAdding] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only state (storage or the device clock) after the server render
    setSaved(loadSaved());
  }, []);

  const kinds = useMemo(() => {
    const out: Kind[] = [pipeline.start];
    for (const s of pipeline.steps) out.push(kindAfter(out[out.length - 1] as Kind, stepById(s.id) as PipelineStep));
    return out;
  }, [pipeline]);
  const endKind = kinds[kinds.length - 1] as Kind;
  const broken = pipeline.steps.findIndex((s, i) => !fits(kinds[i] as Kind, stepById(s.id) as PipelineStep));
  const addable = STEPS.filter((s) => fits(endKind, s));

  const setSteps = (steps: StepUse[]) => setPipeline((p) => ({ ...p, steps }));
  const accept = pipeline.start === 'pdf' ? ['.pdf', 'application/pdf'] : pipeline.start === 'image' ? ['image/*', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp', '.avif'] : [];

  function persist(list: Saved[]) {
    setSaved(list);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      toast.error('This browser does not allow saving.');
    }
  }

  const validate = (files: InputFile[], p: Pipeline): string | null => {
    if (!p.steps.length) return 'Add a step.';
    if (broken >= 0) return `Step ${broken + 1} does not take the files the step before it makes.`;
    for (const s of p.steps) {
      const msg = (stepById(s.id) as PipelineStep).check?.(s.options);
      if (msg) return msg;
    }
    return files.length ? null : 'Add files.';
  };

  const editor = (
    <div className="flex flex-col gap-4">
      <Field label="Recipes">
        <div className="flex flex-wrap gap-1.5">
          {RECIPES.map((r) => (
            <Button
              key={r.name}
              type="button"
              size="sm"
              variant="outline"
              title={r.hint}
              onClick={() => {
                setPipeline({ start: r.start, steps: r.steps.map(([id, o]) => use(id, o)) });
                setName(r.name);
              }}
            >
              {r.name}
            </Button>
          ))}
          {saved.map((s) => (
            <span key={s.name} className="inline-flex items-center rounded-md border">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPipeline({ start: s.start, steps: s.steps.map((x) => use(x.id, x.options)) });
                  setName(s.name);
                }}
              >
                ★ {s.name}
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => persist(saved.filter((x) => x.name !== s.name))}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </span>
          ))}
        </div>
      </Field>
      <SelectField
        label="Start with"
        value={pipeline.start}
        options={[
          { value: 'image', label: 'Images' },
          { value: 'pdf', label: 'PDFs' },
          { value: 'any', label: 'Any files' },
        ]}
        onChange={(v) => setPipeline((p) => ({ ...p, start: v as Kind }))}
      />
      <ol className="flex flex-col gap-2" aria-label="Steps" data-steps>
        {pipeline.steps.map((s, i) => {
          const step = stepById(s.id) as PipelineStep;
          const bad = i === broken;
          return (
            <li key={s.key} className={`flex flex-col gap-2 rounded-lg border p-2.5 ${bad ? 'border-destructive' : ''}`} data-step={s.id}>
              <div className="flex items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 font-mono text-[0.65rem] font-semibold text-primary">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{step.title}</p>
                  <p className="truncate text-[0.7rem] text-muted-foreground">{bad ? `Needs ${step.input} files; it gets ${kinds[i]}.` : step.summary(s.options)}</p>
                </div>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => setSteps(swap(pipeline.steps, i, i - 1))}>
                  <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === pipeline.steps.length - 1} onClick={() => setSteps(swap(pipeline.steps, i, i + 1))}>
                  <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps(pipeline.steps.filter((_, j) => j !== i))}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
              {step.fields.length ? <StepFields step={step} use={s} prefix={`wf-step-${i}`} onChange={(options) => setSteps(pipeline.steps.map((x, j) => (j === i ? { ...x, options } : x)))} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="flex items-end gap-2">
        <SelectField
          className="flex-1"
          label="Add a step"
          value={adding}
          options={[{ value: '', label: addable.length ? 'Choose…' : 'Nothing fits after a ZIP' }, ...addable.map((s) => ({ value: s.id, label: s.title }))]}
          onChange={setAdding}
        />
        <Button
          type="button"
          size="sm"
          disabled={!adding}
          onClick={() => {
            setSteps([...pipeline.steps, use(adding)]);
            setAdding('');
          }}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Add
        </Button>
      </div>
      <div className="flex items-end gap-2 border-t pt-3">
        <Field label="Save as" className="flex-1" htmlFor="wf-name">
          <Input id="wf-name" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!name.trim() || !pipeline.steps.length}
          onClick={() => {
            persist([...saved.filter((x) => x.name !== name.trim()), savable(pipeline, name.trim())]);
            toast.success(`Saved “${name.trim()}” in this browser (passwords are not saved).`);
          }}
        >
          Save workflow
        </Button>
      </div>
    </div>
  );

  return (
    <Workbench
      job={pipelineJob}
      options={pipeline}
      accept={accept}
      runLabel={`Run ${pipeline.steps.length} ${pipeline.steps.length === 1 ? 'step' : 'steps'}`}
      reorderable
      optionsPanel={editor}
      validate={validate}
      zipName="workflow-results.zip"
    />
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b] as T, next[a] as T];
  return next;
}
