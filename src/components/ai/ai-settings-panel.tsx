'use client';

import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  Key01Icon,
  Loading03Icon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useId, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AiError } from '@/lib/ai/errors';
import { hostOf, listModels, PROVIDER_IDS, PROVIDERS } from '@/lib/ai/providers';
import {
  clearAiSettings,
  isConfigured,
  removeProvider,
  setDefaultProvider,
  updateProvider,
  useAiSettings,
} from '@/lib/ai/settings';
import type { ProviderId } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { LocalModelsSection } from './local-models';

/** Keys, models and the default provider for the AI tools, plus downloaded on-device models. */
export function AiSettingsPanel({ compact = false }: { compact?: boolean }) {
  const settings = useAiSettings();
  const configured = PROVIDER_IDS.filter((id) => isConfigured(settings.providers[id], id));

  return (
    <div className="flex flex-col gap-4">
      <div
        data-ai-key-note
        className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs/relaxed text-muted-foreground"
      >
        <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <p>
          API keys are <strong className="text-foreground">stored on this device only</strong>, in this browser&apos;s
          local storage. They are sent only to the provider they belong to, directly from your browser, when you ask
          an AI tool a question. Metamorpher has no server that could see them. Anyone with access to this browser
          profile can read them; remove them when you are done on a shared computer.
        </p>
      </div>

      <div className={cn('grid gap-3', compact ? '' : 'md:grid-cols-2')}>
        {PROVIDER_IDS.map((id) => (
          <ProviderCard key={id} id={id} isDefault={settings.defaultProvider === id && configured.includes(id)} />
        ))}
      </div>

      {configured.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>
            {configured.length} provider{configured.length === 1 ? '' : 's'} set up.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm('Remove every saved API key and AI setting from this browser?')) clearAiSettings();
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Remove all keys
          </Button>
        </div>
      ) : null}

      {compact ? null : <LocalModelsSection />}
    </div>
  );
}

type TestState = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; text: string } | { state: 'error'; text: string };

function ProviderCard({ id, isDefault }: { id: ProviderId; isDefault: boolean }) {
  const info = PROVIDERS[id];
  const settings = useAiSettings();
  const saved = settings.providers[id];
  const uid = useId();
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<TestState>({ state: 'idle' });
  // Unsaved edits; null shows the saved value (so removal elsewhere clears the field).
  const [keyEdit, setKeyDraft] = useState<string | null>(null);
  const [baseEdit, setBaseDraft] = useState<string | null>(null);
  const keyDraft = keyEdit ?? saved?.apiKey ?? '';
  const baseDraft = baseEdit ?? saved?.baseUrl ?? (id === 'custom' ? info.baseUrl : '');
  const ready = isConfigured(saved, id);

  const models = saved?.models ?? [];
  const modelValue = saved?.model ?? info.defaultModel;

  const commitKey = () => {
    if ((saved?.apiKey ?? '') !== keyDraft.trim() || (id === 'custom' && (saved?.baseUrl ?? '') !== baseDraft.trim())) {
      updateProvider(id, { apiKey: keyDraft.trim(), ...(id === 'custom' ? { baseUrl: baseDraft.trim() } : {}) });
      setTest({ state: 'idle' });
    }
    setKeyDraft(null);
    setBaseDraft(null);
  };

  const runTest = async () => {
    commitKey();
    setTest({ state: 'busy' });
    try {
      const list = await listModels({ provider: id, apiKey: keyDraft.trim(), baseUrl: baseDraft.trim() || undefined });
      const keep = list.some((m) => m.id === modelValue) ? modelValue : modelValue || list[0]?.id || '';
      updateProvider(id, {
        apiKey: keyDraft.trim(),
        models: list.slice(0, 500),
        model: keep,
        ...(id === 'custom' ? { baseUrl: baseDraft.trim() } : {}),
      });
      setTest({ state: 'ok', text: `Connected. ${list.length} model${list.length === 1 ? '' : 's'} available.` });
    } catch (err) {
      setTest({ state: 'error', text: err instanceof AiError || err instanceof Error ? err.message : 'The test failed.' });
    }
  };

  return (
    <SectionCard
      data-provider={id}
      title={
        <span className="flex items-center gap-2">
          {info.label}
          {ready ? <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-success" /> : null}
        </span>
      }
      description={id === 'custom' ? 'Local or self-hosted servers' : info.host}
      action={
        ready ? (
          isDefault ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[0.65rem] font-medium">Default</span>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => setDefaultProvider(id)}>
              Make default
            </Button>
          )
        ) : null
      }
      contentClassName="flex flex-col gap-3"
    >
      {id === 'custom' ? (
        <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={`${uid}-base`}>
          Base URL
          <Input
            id={`${uid}-base`}
            value={baseDraft}
            onChange={(e) => setBaseDraft(e.target.value)}
            onBlur={commitKey}
            placeholder="http://localhost:11434/v1"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={`${uid}-key`}>
        API key{info.keyOptional ? ' (optional)' : ''}
        <span className="flex gap-1.5">
          <Input
            id={`${uid}-key`}
            type={reveal ? 'text' : 'password'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={commitKey}
            placeholder={info.keyPlaceholder}
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
          <Button
            variant="outline"
            size="icon-sm"
            type="button"
            aria-label={reveal ? 'Hide key' : 'Show key'}
            onClick={() => setReveal((r) => !r)}
          >
            <HugeiconsIcon icon={reveal ? ViewOffIcon : ViewIcon} strokeWidth={2} />
          </Button>
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor={`${uid}-model`}>
        Model
        <Input
          id={`${uid}-model`}
          list={`${uid}-models`}
          value={modelValue}
          onChange={(e) => updateProvider(id, { model: e.target.value })}
          placeholder={models.length ? 'Pick or type a model id' : 'Test the key to load the model list, or type an id'}
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id={`${uid}-models`}>
          {(models.length ? models : info.suggestedModels.map((m) => ({ id: m, label: undefined }))).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label && m.label !== m.id ? m.label : null}
            </option>
          ))}
        </datalist>
      </label>
      {info.note ? <p className="text-[0.7rem]/relaxed text-muted-foreground">{info.note}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={test.state === 'busy' || (!keyDraft.trim() && !info.keyOptional) || (id === 'custom' && !baseDraft.trim())}
        >
          {test.state === 'busy' ? <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" /> : null}
          Test &amp; load models
        </Button>
        {saved ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              removeProvider(id);
              setKeyDraft(null);
              setBaseDraft(null);
              setTest({ state: 'idle' });
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Remove
          </Button>
        ) : null}
        {info.keyUrl ? (
          <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-primary hover:underline">
            Get a key
          </a>
        ) : null}
      </div>
      {test.state === 'ok' || test.state === 'error' ? (
        <p
          role={test.state === 'error' ? 'alert' : 'status'}
          data-test-result={test.state}
          className={cn('text-xs/relaxed', test.state === 'error' ? 'text-destructive' : 'text-success')}
        >
          {test.text}
        </p>
      ) : null}
      {ready ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          Requests go from this browser to {hostOf({ provider: id, baseUrl: saved?.baseUrl })}.
        </p>
      ) : null}
    </SectionCard>
  );
}
