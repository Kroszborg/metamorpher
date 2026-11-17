'use client';

import { Globe02Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect } from '@/components/workbench';
import { isNotDownloaded, localAi } from '@/engines/ai';
import { AiError } from '@/lib/ai/errors';
import { hostOf, PROVIDERS, streamChat } from '@/lib/ai/providers';
import { configuredProviders, setDefaultProvider, targetFor, useAiSettings } from '@/lib/ai/settings';
import type { ChatMessage, ProviderTarget } from '@/lib/ai/types';
import { AiSettingsButton } from './ai-settings-dialog';
import { ModelGate } from './model-gate';
import { type LocalModel, useLocalModel } from './use-local-model';

export type AnswerMode = 'device' | 'cloud';

const MODE_KEY = 'metamorpher:ai-answer-mode';
const MODE_EVENT = 'metamorpher:ai-answer-mode';

function readMode(): AnswerMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'cloud' ? 'cloud' : 'device';
  } catch {
    return 'device';
  }
}

function subscribeMode(cb: () => void): () => void {
  window.addEventListener(MODE_EVENT, cb);
  return () => window.removeEventListener(MODE_EVENT, cb);
}

export type Answerer = {
  mode: AnswerMode;
  setMode: (m: AnswerMode) => void;
  local: LocalModel;
  cloud: ProviderTarget | null;
  /** Why the current mode cannot answer yet, or null when it can. */
  blocked: string | null;
  /** Human label: "Qwen2.5 0.5B on this device" / "Anthropic (Claude) · claude-opus-5-5". */
  label: string;
  /** Approximate characters of excerpts this mode should receive. */
  budget: number;
};

/** The choice between an on-device model and the user's own provider key, shared by the AI tools. */
export function useAnswerer(prefKey: string): Answerer {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'device' as AnswerMode);
  const settings = useAiSettings();
  const local = useLocalModel('chat', 'qwen2.5-0.5b', `${prefKey}-chat`);
  const cloud = targetFor(settings);
  const setMode = (m: AnswerMode) => {
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  };
  const blocked =
    mode === 'cloud'
      ? cloud
        ? null
        : 'Add an API key in AI settings to use a cloud model.'
      : local.status === 'ready'
        ? null
        : local.status === 'unsupported'
          ? 'This device cannot run the selected on-device model.'
          : local.status === 'downloading'
            ? 'The model is downloading…'
            : local.status === 'checking'
              ? 'Checking the on-device model…'
              : 'Download the on-device model first.';
  const label =
    mode === 'cloud'
      ? cloud
        ? `${PROVIDERS[cloud.provider].label} · ${cloud.model}`
        : 'No provider set up'
      : `${local.spec.label} on this device`;
  const budget = mode === 'cloud' ? 9000 : local.plan?.device === 'webgpu' ? 3200 : 2200;
  return { mode, setMode, local, cloud, blocked, label, budget };
}

/** Streams an answer with whichever mode is selected. */
export async function answerWith(
  a: Answerer,
  messages: ChatMessage[],
  { signal, onText, maxTokens }: { signal?: AbortSignal; onText?: (delta: string, full: string) => void; maxTokens?: number },
): Promise<string> {
  if (a.mode === 'cloud') {
    if (!a.cloud) throw new AiError('auth', 'Add an API key in AI settings first.');
    const r = await streamChat(a.cloud, messages, { signal, onText, maxTokens: maxTokens ?? 4096 });
    if (r.stopReason === 'length') return `${r.text}\n\n_(The answer was cut off at the length limit.)_`;
    return r.text;
  }
  const plan = a.local.plan;
  if (!plan || plan.device === null) throw new Error('This device cannot run the on-device model.');
  try {
    return await localAi.generate(a.local.spec, messages, {
      device: plan.device,
      signal,
      maxNewTokens: Math.min(maxTokens ?? 512, 1024),
      onText: (piece, full) => onText?.(piece, full),
    });
  } catch (err) {
    if (isNotDownloaded(err)) {
      a.local.markMissing();
      throw new Error('The on-device model is no longer in this browser’s storage. Download it again.');
    }
    throw err;
  }
}

/** Mode switch, model or provider choice, and the plain statement of what is sent where. */
export function AnswerModePanel({
  answerer: a,
  idPrefix,
  sends,
}: {
  answerer: Answerer;
  idPrefix: string;
  /** What a request contains, e.g. "your question, the last 6 messages and up to 8 passages". */
  sends: string;
}) {
  const settings = useAiSettings();
  const providers = configuredProviders(settings);
  return (
    <div className="flex flex-col gap-3">
      <OptionField label="Answer with">
        <Segmented<AnswerMode>
          label="Answer with"
          value={a.mode}
          options={[
            { value: 'device', label: 'On this device' },
            { value: 'cloud', label: 'My API key' },
          ]}
          onChange={a.setMode}
        />
      </OptionField>

      {a.mode === 'device' ? (
        <>
          <ModelGate model={a.local} id={`${idPrefix}-local-model`} />
          <p className="flex items-start gap-1.5 text-[0.7rem]/relaxed text-muted-foreground">
            <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0 text-primary" />
            Fully private: the model runs in this browser and nothing is sent anywhere. Small models are less accurate
            than cloud models; check important answers against the cited pages.
          </p>
        </>
      ) : (
        <>
          {providers.length > 1 ? (
            <OptionField label="Provider" htmlFor={`${idPrefix}-provider`}>
              <OptionSelect
                id={`${idPrefix}-provider`}
                value={settings.defaultProvider ?? providers[0] ?? 'anthropic'}
                options={providers.map((p) => ({ value: p, label: `${PROVIDERS[p].label} · ${settings.providers[p]?.model}` }))}
                onChange={setDefaultProvider}
              />
            </OptionField>
          ) : null}
          {a.cloud ? (
            <p data-disclosure className="flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-[0.7rem]/relaxed text-muted-foreground">
              <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0 text-warning" />
              <span>
                Each request sends {sends} to <strong className="text-foreground">{PROVIDERS[a.cloud.provider].label}</strong>{' '}
                ({hostOf(a.cloud)}, model {a.cloud.model}) with your key, straight from this browser. Nothing else from
                your files is sent, and nothing goes to Metamorpher. The provider&apos;s own data policy applies.
              </span>
            </p>
          ) : (
            <p className="text-xs/relaxed text-muted-foreground">
              No provider is set up yet. Add a key for Anthropic, OpenAI, Gemini, Groq, OpenRouter or a local
              OpenAI-compatible server.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <AiSettingsButton label={a.cloud ? 'AI settings' : 'Add an API key'} />
            <Link href="/settings/ai" className="text-xs text-primary hover:underline">
              All AI settings
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
