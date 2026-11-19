'use client';

/**
 * Saved AI provider settings: API keys, chosen models and the default
 * provider. Stored in this browser's localStorage only — never sent anywhere
 * except to the provider the key belongs to, never logged, never in URLs.
 */
import { useSyncExternalStore } from 'react';
import { pickDefaultModel, PROVIDERS } from './providers';
import type { ModelOption, ProviderId, ProviderTarget } from './types';

export type ProviderSettings = {
  apiKey: string;
  model: string;
  /** OpenAI-compatible provider only. */
  baseUrl?: string;
  /** Last fetched model list (no secrets). */
  models?: ModelOption[];
};

export type AiSettings = {
  defaultProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
};

const KEY = 'metamorpher:ai-settings:v1';
const EVENT = 'metamorpher:ai-settings';
const EMPTY: AiSettings = { defaultProvider: null, providers: {} };

let cache: { raw: string | null; value: AiSettings } | null = null;

/**
 * Earlier versions preselected the first model a provider listed, which for
 * some providers is a tiny special-purpose model. Where the saved model is
 * still that first entry and a preferred one is listed, switch to it.
 */
function repick(value: AiSettings): AiSettings {
  let providers = value.providers;
  for (const id of Object.keys(providers) as ProviderId[]) {
    const p = providers[id];
    if (!p?.models?.length || !PROVIDERS[id]?.preferredModels || p.model !== p.models[0]?.id) continue;
    const better = pickDefaultModel(id, p.models);
    if (better && better !== p.model) providers = { ...providers, [id]: { ...p, model: better } };
  }
  return providers === value.providers ? value : { ...value, providers };
}

function read(): AiSettings {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      value = {
        defaultProvider: parsed.defaultProvider && parsed.defaultProvider in PROVIDERS ? parsed.defaultProvider : null,
        providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
      };
    } catch {
      value = EMPTY;
    }
  }
  cache = { raw, value: repick(value) };
  return cache.value;
}

function write(next: AiSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: settings then last for this page only.
  }
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

export function getAiSettings(): AiSettings {
  return typeof window === 'undefined' ? EMPTY : read();
}

export function updateProvider(id: ProviderId, patch: Partial<ProviderSettings>): void {
  const current = getAiSettings();
  const prev = current.providers[id] ?? { apiKey: '', model: PROVIDERS[id].defaultModel };
  const providers = { ...current.providers, [id]: { ...prev, ...patch } };
  write({ defaultProvider: current.defaultProvider ?? id, providers });
}

/** Forgets the key, model and list for one provider. */
export function removeProvider(id: ProviderId): void {
  const current = getAiSettings();
  const providers = { ...current.providers };
  delete providers[id];
  const remaining = (Object.keys(providers) as ProviderId[]).filter((p) => isConfigured(providers[p], p));
  write({
    defaultProvider: current.defaultProvider === id ? (remaining[0] ?? null) : current.defaultProvider,
    providers,
  });
}

export function setDefaultProvider(id: ProviderId): void {
  write({ ...getAiSettings(), defaultProvider: id });
}

/** Removes every saved key and setting. */
export function clearAiSettings(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

export function isConfigured(p: ProviderSettings | undefined, id: ProviderId): boolean {
  if (!p) return false;
  if (id === 'custom') return !!p.baseUrl?.trim() && !!p.model.trim();
  return !!p.apiKey.trim() && !!p.model.trim();
}

/** The request target for a provider (or the default one), or null when it is not set up. */
export function targetFor(settings: AiSettings, id?: ProviderId | null): ProviderTarget | null {
  const provider = id ?? settings.defaultProvider;
  if (!provider) return null;
  const p = settings.providers[provider];
  if (!p || !isConfigured(p, provider)) return null;
  return { provider, apiKey: p.apiKey.trim(), model: p.model.trim(), baseUrl: p.baseUrl?.trim() || undefined };
}

export function configuredProviders(settings: AiSettings): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => isConfigured(settings.providers[id], id));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Live settings; updates in every component (and other tabs) when they change. */
export function useAiSettings(): AiSettings {
  return useSyncExternalStore(subscribe, getAiSettings, () => EMPTY);
}
