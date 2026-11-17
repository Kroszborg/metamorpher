'use client';

import { CheckmarkCircle02Icon, CloudDownloadIcon, CpuIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { OptionField, OptionSelect } from '@/components/workbench';
import { Button } from '@/components/ui/button';
import { MODEL_HOST, type ModelSpec } from '@/engines/ai';
import { formatBytes } from '@/lib/files';
import type { LocalModel } from './use-local-model';

function sizeLabel(spec: ModelSpec, m: LocalModel): string {
  const plan = m.device ? (spec.key === m.spec.key ? m.plan : null) : null;
  const bytes = plan && plan.device ? plan.bytes : (spec.bytes.webgpu ?? spec.bytes.wasm ?? 0);
  return formatBytes(bytes);
}

/**
 * Model picker plus the explicit download step: size, host and licence are
 * shown before anything is fetched, with progress and cancel while it runs.
 */
export function ModelGate({ model, label = 'Model', id }: { model: LocalModel; label?: string; id: string }) {
  const { spec, plan, status, progress } = model;
  return (
    <div className="flex flex-col gap-3" data-model-gate={status}>
      {model.choices.length > 1 ? (
        <OptionField label={label} htmlFor={id} hint={spec.blurb}>
          <OptionSelect
            id={id}
            value={spec.key}
            options={model.choices.map((c) => ({
              value: c.key,
              label: `${c.label} · ${sizeLabel(c, model)}`,
            }))}
            onChange={model.setKey}
          />
        </OptionField>
      ) : null}

      {plan && plan.device ? (
        <p className="flex items-start gap-1.5 text-[0.7rem]/relaxed text-muted-foreground">
          <HugeiconsIcon icon={CpuIcon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
          {plan.device === 'webgpu'
            ? 'Runs on your graphics card (WebGPU).'
            : 'Runs on the CPU (WebAssembly, one thread): slower, but works everywhere. WebGPU is not available in this browser.'}
        </p>
      ) : null}

      {status === 'unsupported' && plan && plan.device === null ? (
        <p role="alert" className="text-xs/relaxed text-destructive">
          {plan.reason}
        </p>
      ) : null}

      {status === 'missing' && plan && plan.device ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5" data-download-consent>
          <p className="text-xs/relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{spec.label}</span> ({spec.licence}) is downloaded once from{' '}
            <a href={spec.licenceUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
              {MODEL_HOST}
            </a>{' '}
            — <strong className="text-foreground">{formatBytes(plan.bytes)}</strong> — and then kept in this browser so it
            works offline. Hugging Face sees your IP address for the download; your files are never sent.
          </p>
          <Button size="sm" onClick={model.download} className="self-start" data-action="download-model">
            <HugeiconsIcon icon={CloudDownloadIcon} strokeWidth={2} />
            Download {formatBytes(plan.bytes)}
          </Button>
        </div>
      ) : null}

      {status === 'downloading' && progress ? (
        <div className="flex flex-col gap-1.5" data-downloading>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.min(100, (progress.loaded / Math.max(1, progress.total)) * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
            <span>
              {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
              {progress.loaded >= progress.total * 0.99 ? ' · starting the model…' : ''}
            </span>
            <Button variant="ghost" size="xs" onClick={model.cancelDownload}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {status === 'ready' ? (
        <p className="flex items-center gap-1.5 text-[0.7rem]/relaxed text-muted-foreground" data-model-ready>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-success" />
          {spec.label} is downloaded and runs offline.{' '}
          <Link href="/settings/ai" className="text-primary hover:underline">
            Manage models
          </Link>
        </p>
      ) : null}

      {model.error ? (
        <p role="alert" className="text-xs/relaxed text-destructive">
          {model.error}
        </p>
      ) : null}
    </div>
  );
}
