/**
 * Bring-your-own-key AI providers, called straight from the browser.
 *
 * Wire formats (checked against each provider's documentation, November 2026):
 * - Anthropic: POST https://api.anthropic.com/v1/messages, headers `x-api-key`,
 *   `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`
 *   (required for CORS). SSE events message_start, content_block_delta (text_delta;
 *   thinking deltas ignored), message_delta (stop_reason), message_stop, error.
 *   Models: GET /v1/models (data[].id, display_name, max_input_tokens).
 * - OpenAI: POST https://api.openai.com/v1/responses with `stream: true` and
 *   `store: false`; SSE events response.output_text.delta (`delta`),
 *   response.completed, response.incomplete, response.failed, error.
 *   Models: GET /v1/models.
 * - Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
 *   with the key in the `x-goog-api-key` header (never in the URL). Roles user/model,
 *   `systemInstruction`, chunks carry candidates[].content.parts[].text (parts with
 *   `thought: true` skipped), finishReason, promptFeedback.blockReason.
 *   Models: GET /v1beta/models (models[].name "models/…", supportedGenerationMethods).
 * - Groq (https://api.groq.com/openai/v1), OpenRouter (https://openrouter.ai/api/v1) and any
 *   OpenAI-compatible server (Ollama, LM Studio, vLLM…): POST {base}/chat/completions,
 *   SSE chunks choices[].delta.content, finish_reason, `data: [DONE]`; OpenRouter may send
 *   ": OPENROUTER PROCESSING" comments and a mid-stream `error` object. Models: GET {base}/models.
 */
import { AiError, classifyHttpError, networkError, redact } from './errors';
import { readSse } from './sse';
import type { ChatMessage, ChatOptions, ModelOption, ProviderId, ProviderTarget, StopReason, StreamResult } from './types';

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Shown in the "what is sent where" disclosure. */
  host: string;
  baseUrl: string;
  /** Where people create a key. */
  keyUrl?: string;
  keyPlaceholder: string;
  /** The custom provider works without a key (local servers). */
  keyOptional?: boolean;
  /** Preselected until the user picks from the fetched list. Empty: pick the first listed. */
  defaultModel: string;
  /** Offered before (or instead of) a fetched list. */
  suggestedModels: readonly string[];
  /** When there is no default: the first fetched model matching one of these, in order, is preselected. */
  preferredModels?: readonly RegExp[];
  /** Whether this provider has a speech-to-text endpoint the transcribe tool can use. */
  transcription?: { model: string; url: string };
  note?: string;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    host: 'api.anthropic.com',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    defaultModel: 'gpt-6.1-terra',
    suggestedModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
    transcription: { model: 'whisper-1', url: 'https://api.openai.com/v1/audio/transcriptions' },
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    host: 'generativelanguage.googleapis.com',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    defaultModel: 'gemini-3.6-flash',
    suggestedModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    host: 'api.groq.com',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    defaultModel: '',
    suggestedModels: [],
    // Groq's list changes often and starts with small special-purpose models, so prefer a general chat model.
    preferredModels: [/llama-3\.3-70b-versatile/, /llama.*70b/, /gpt-oss-120b/, /llama.*versatile/, /llama/],
    transcription: { model: 'whisper-large-v3-turbo', url: 'https://api.groq.com/openai/v1/audio/transcriptions' },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    host: 'openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-…',
    defaultModel: 'openrouter/auto',
    suggestedModels: ['openrouter/auto'],
    note: 'OpenRouter forwards your text to the model vendor you pick.',
  },
  custom: {
    id: 'custom',
    label: 'OpenAI-compatible (Ollama, LM Studio…)',
    host: '',
    baseUrl: 'http://localhost:11434/v1',
    keyPlaceholder: 'Optional',
    keyOptional: true,
    defaultModel: '',
    suggestedModels: [],
    note:
      'Any server with an OpenAI-style /chat/completions endpoint. It must allow requests from this site (Ollama: OLLAMA_ORIGINS; LM Studio: Enable CORS). Chrome may ask to allow access to devices on your network.',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** The base URL a target talks to (the user's own for the compatible provider). */
export function baseUrlOf(target: Pick<ProviderTarget, 'provider' | 'baseUrl'>): string {
  const base = target.provider === 'custom' && target.baseUrl ? target.baseUrl : PROVIDERS[target.provider].baseUrl;
  return base.replace(/\/+$/, '');
}

/** Host name shown in disclosures ("api.anthropic.com", "localhost:11434"). */
export function hostOf(target: Pick<ProviderTarget, 'provider' | 'baseUrl'>): string {
  try {
    return new URL(baseUrlOf(target)).host;
  } catch {
    return PROVIDERS[target.provider].host || baseUrlOf(target);
  }
}

// ── Requests ──────────────────────────────────────────────────────────────

type Built = { url: string; init: RequestInit };

function jsonHeaders(extra: Record<string, string>): Record<string, string> {
  return { 'content-type': 'application/json', ...extra };
}

function splitSystem(messages: readonly ChatMessage[]): { system: string; turns: ChatMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, turns: messages.filter((m) => m.role !== 'system') };
}

function anthropicHeaders(key: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** Builds the HTTP request for a streaming chat call. Exported for tests. */
export function buildChatRequest(target: ProviderTarget, messages: readonly ChatMessage[], maxTokens: number): Built {
  const base = baseUrlOf(target);
  const { system, turns } = splitSystem(messages);
  switch (target.provider) {
    case 'anthropic':
      return {
        url: `${base}/messages`,
        init: {
          method: 'POST',
          headers: jsonHeaders(anthropicHeaders(target.apiKey)),
          body: JSON.stringify({
            model: target.model,
            max_tokens: maxTokens,
            stream: true,
            ...(system ? { system } : {}),
            messages: turns.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
      };
    case 'openai':
      return {
        url: `${base}/responses`,
        init: {
          method: 'POST',
          headers: jsonHeaders({ authorization: `Bearer ${target.apiKey}` }),
          body: JSON.stringify({
            model: target.model,
            stream: true,
            store: false,
            max_output_tokens: maxTokens,
            ...(system ? { instructions: system } : {}),
            input: turns.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
      };
    case 'gemini':
      return {
        url: `${base}/models/${encodeURIComponent(target.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`,
        init: {
          method: 'POST',
          headers: jsonHeaders({ 'x-goog-api-key': target.apiKey }),
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        },
      };
    default: {
      const headers: Record<string, string> = {};
      if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
      if (target.provider === 'openrouter') headers['X-Title'] = 'Metamorpher';
      return {
        url: `${base}/chat/completions`,
        init: {
          method: 'POST',
          headers: jsonHeaders(headers),
          body: JSON.stringify({
            model: target.model,
            stream: true,
            max_tokens: maxTokens,
            // Document answers should be steady, and small models loop without a repetition penalty.
            temperature: 0.2,
            frequency_penalty: 0.4,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
      };
    }
  }
}

async function send(target: ProviderTarget, built: Built, signal?: AbortSignal): Promise<Response> {
  const info = PROVIDERS[target.provider];
  let res: Response;
  try {
    res = await fetch(built.url, {
      ...built.init,
      signal,
      // Keys go in headers; never send cookies or a referrer path to a provider.
      credentials: 'omit',
      referrerPolicy: 'origin',
      cache: 'no-store',
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw networkError(target.provider, info.label, hostOf(target));
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw classifyHttpError(info.label, res.status, raw, target.apiKey);
  }
  return res;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function parseJson(data: string): Json | null {
  try {
    return obj(JSON.parse(data));
  } catch {
    return null;
  }
}

/** One streamed event → text delta, stop reason or error, per wire format. */
type Step = { text?: string; stop?: StopReason; error?: string; done?: boolean };

function anthropicStep(event: string, json: Json): Step {
  const type = str(json.type) || event;
  if (type === 'content_block_delta') {
    const delta = obj(json.delta);
    return delta.type === 'text_delta' ? { text: str(delta.text) } : {};
  }
  if (type === 'message_delta') {
    const reason = str(obj(json.delta).stop_reason);
    if (!reason) return {};
    return {
      stop: reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'refusal' : reason ? 'end' : 'unknown',
    };
  }
  if (type === 'message_stop') return { done: true };
  if (type === 'error') return { error: str(obj(json.error).message) || 'The stream reported an error.' };
  return {};
}

function openaiResponsesStep(event: string, json: Json): Step {
  const type = str(json.type) || event;
  if (type === 'response.output_text.delta') return { text: str(json.delta) };
  if (type === 'response.completed') return { stop: 'end', done: true };
  if (type === 'response.incomplete') {
    const reason = str(obj(obj(json.response).incomplete_details).reason);
    return { stop: reason === 'max_output_tokens' ? 'length' : reason === 'content_filter' ? 'filtered' : 'unknown', done: true };
  }
  if (type === 'response.refusal.delta') return { text: str(json.delta) };
  if (type === 'response.failed') {
    return { error: str(obj(obj(json.response).error).message) || 'The response failed.' };
  }
  if (type === 'error') return { error: str(json.message) || str(obj(json.error).message) || 'The stream reported an error.' };
  return {};
}

function geminiStep(json: Json): Step {
  const block = str(obj(json.promptFeedback).blockReason);
  if (block) return { stop: 'filtered', error: `Gemini blocked the request (${block}).` };
  if (json.error) return { error: str(obj(json.error).message) || 'The stream reported an error.' };
  const candidate = obj(Array.isArray(json.candidates) ? json.candidates[0] : undefined);
  const parts = Array.isArray(obj(candidate.content).parts) ? (obj(candidate.content).parts as unknown[]) : [];
  const text = parts
    .map(obj)
    .filter((p) => p.thought !== true)
    .map((p) => str(p.text))
    .join('');
  const reason = str(candidate.finishReason);
  const stop: StopReason | undefined = !reason
    ? undefined
    : reason === 'STOP'
      ? 'end'
      : reason === 'MAX_TOKENS'
        ? 'length'
        : /SAFETY|BLOCK|PROHIBITED|RECITATION|SPII/.test(reason)
          ? 'filtered'
          : 'unknown';
  return { text, stop };
}

function chatCompletionsStep(data: string, json: Json | null): Step {
  if (data.trim() === '[DONE]') return { done: true };
  if (!json) return {};
  if (json.error) return { error: str(obj(json.error).message) || 'The stream reported an error.' };
  const choice = obj(Array.isArray(json.choices) ? json.choices[0] : undefined);
  const text = str(obj(choice.delta).content);
  const reason = str(choice.finish_reason);
  const stop: StopReason | undefined = !reason
    ? undefined
    : reason === 'stop'
      ? 'end'
      : reason === 'length'
        ? 'length'
        : reason === 'content_filter'
          ? 'filtered'
          : reason === 'error'
            ? 'unknown'
            : 'end';
  return { text, stop };
}

/**
 * Streams a chat completion from the target provider. Resolves with the whole
 * text; `onText` sees each piece as it arrives. Rejects with an AiError (or an
 * AbortError when `signal` fires).
 */
export async function streamChat(
  target: ProviderTarget,
  messages: readonly ChatMessage[],
  { signal, onText, maxTokens = 4096 }: ChatOptions = {},
): Promise<StreamResult> {
  const info = PROVIDERS[target.provider];
  if (!target.model.trim()) throw new AiError('model', `Choose a ${info.label} model in AI settings first.`);
  if (!target.apiKey && !info.keyOptional) throw new AiError('auth', `Add a ${info.label} API key in AI settings first.`);
  const res = await send(target, buildChatRequest(target, messages, maxTokens), signal);
  if (!res.body) throw new AiError('server', `${info.label} sent an empty response.`);

  let text = '';
  let stop: StopReason = 'unknown';
  for await (const ev of readSse(res.body, signal)) {
    const json = parseJson(ev.data);
    let step: Step;
    if (target.provider === 'anthropic') step = json ? anthropicStep(ev.event, json) : {};
    else if (target.provider === 'openai') step = json ? openaiResponsesStep(ev.event, json) : {};
    else if (target.provider === 'gemini') step = json ? geminiStep(json) : {};
    else step = chatCompletionsStep(ev.data, json);

    if (step.text) {
      text += step.text;
      onText?.(step.text, text);
    }
    if (step.stop) stop = step.stop;
    if (step.error) {
      const message = redact(step.error, target.apiKey);
      if (/overloaded|rate/i.test(message)) throw new AiError('rate', `${info.label} is overloaded right now: ${message}`);
      if (/context|too long|maximum.*tokens/i.test(message)) throw new AiError('context', `The request is too long for this model: ${message}`);
      throw new AiError('server', `${info.label} stopped with an error: ${message}`);
    }
    if (step.done) break;
  }
  if (signal?.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
  if (stop === 'refusal' && !text.trim()) {
    throw new AiError('refused', `${info.label} declined to answer this request.`);
  }
  if (stop === 'filtered' && !text.trim()) {
    throw new AiError('refused', `${info.label}'s safety filter blocked this answer.`);
  }
  return { text, stopReason: stop };
}

// ── Model lists ───────────────────────────────────────────────────────────

const NON_CHAT = /embed|whisper|tts|transcri|dall-e|image|moderation|realtime|audio|search|davinci|babbage|rerank|guard|aqa|imagen|veo|lyria|speech|vision-preview|computer-use/i;

/** Builds the HTTP request for the provider's model list. Exported for tests. */
export function buildModelsRequest(target: Pick<ProviderTarget, 'provider' | 'apiKey' | 'baseUrl'>): Built {
  const base = baseUrlOf(target);
  switch (target.provider) {
    case 'anthropic':
      return { url: `${base}/models?limit=100`, init: { headers: anthropicHeaders(target.apiKey) } };
    case 'gemini':
      return { url: `${base}/models?pageSize=200`, init: { headers: { 'x-goog-api-key': target.apiKey } } };
    default:
      return {
        url: `${base}/models`,
        init: { headers: target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {} },
      };
  }
}

/** Fetches the models this key can use. Also the "test key" call: it fails on a bad key. */
/** Models that answer with something other than chat text: never preselect them. */
const NOT_CHAT = /whisper|tts|guard|embed|moderation|rerank|playai|orpheus|speech/i;

/** The model to preselect from a fetched list when the user has not chosen one. */
export function pickDefaultModel(provider: ProviderId, list: readonly { id: string }[]): string {
  for (const want of PROVIDERS[provider].preferredModels ?? []) {
    const hit = list.find((m) => want.test(m.id) && !NOT_CHAT.test(m.id));
    if (hit) return hit.id;
  }
  return (list.find((m) => !NOT_CHAT.test(m.id)) ?? list[0])?.id ?? '';
}

export async function listModels(
  target: Pick<ProviderTarget, 'provider' | 'apiKey' | 'baseUrl'>,
  signal?: AbortSignal,
): Promise<ModelOption[]> {
  const info = PROVIDERS[target.provider];
  if (!target.apiKey && !info.keyOptional) throw new AiError('auth', `Add a ${info.label} API key first.`);
  const res = await send({ ...target, model: '' }, buildModelsRequest(target), signal);
  const json = obj(await res.json().catch(() => null));
  let models: ModelOption[];
  if (target.provider === 'gemini') {
    models = (Array.isArray(json.models) ? json.models : []).map(obj).flatMap((m) => {
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (!methods.includes('generateContent')) return [];
      return [
        {
          id: str(m.name).replace(/^models\//, ''),
          label: str(m.displayName) || undefined,
          contextTokens: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : undefined,
        },
      ];
    });
  } else {
    models = (Array.isArray(json.data) ? json.data : []).map(obj).map((m) => ({
      id: str(m.id),
      label: str(m.display_name) || str(m.name) || undefined,
      contextTokens:
        typeof m.max_input_tokens === 'number'
          ? m.max_input_tokens
          : typeof m.context_length === 'number'
            ? m.context_length
            : typeof m.context_window === 'number'
              ? m.context_window
              : undefined,
    }));
  }
  const filtered = models.filter((m) => m.id && (target.provider === 'custom' || !NON_CHAT.test(m.id)));
  if (target.provider === 'openrouter' && !filtered.some((m) => m.id === 'openrouter/auto')) {
    filtered.unshift({ id: 'openrouter/auto', label: 'Auto (OpenRouter picks)' });
  }
  return target.provider === 'anthropic' || target.provider === 'openrouter'
    ? filtered
    : filtered.sort((a, b) => a.id.localeCompare(b.id));
}

/** Sends audio to the provider's Whisper endpoint (Groq or OpenAI). Returns verbose JSON segments. */
export async function transcribeRemote(
  target: Pick<ProviderTarget, 'provider' | 'apiKey'>,
  audio: Blob,
  fileName: string,
  { language, signal }: { language?: string; signal?: AbortSignal },
): Promise<{ text: string; language?: string; segments: { start: number; end: number; text: string }[] }> {
  const info = PROVIDERS[target.provider];
  if (!info.transcription) throw new AiError('model', `${info.label} has no transcription endpoint here.`);
  if (!target.apiKey) throw new AiError('auth', `Add a ${info.label} API key in AI settings first.`);
  const form = new FormData();
  form.append('file', audio, fileName);
  form.append('model', info.transcription.model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);
  const res = await send(
    { provider: target.provider, apiKey: target.apiKey, model: info.transcription.model },
    {
      url: info.transcription.url,
      init: { method: 'POST', headers: { authorization: `Bearer ${target.apiKey}` }, body: form },
    },
    signal,
  );
  const json = obj(await res.json().catch(() => null));
  const segments = (Array.isArray(json.segments) ? json.segments : []).map(obj).map((s) => ({
    start: typeof s.start === 'number' ? s.start : 0,
    end: typeof s.end === 'number' ? s.end : 0,
    text: str(s.text),
  }));
  return { text: str(json.text), language: str(json.language) || undefined, segments };
}
