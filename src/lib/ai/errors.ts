import type { ProviderId } from './types';

export type AiErrorKind =
  | 'auth'
  | 'quota'
  | 'rate'
  | 'context'
  | 'model'
  | 'network'
  | 'refused'
  | 'server'
  | 'bad-request';

/** A provider failure with a message written for people, never containing the key. */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Removes the key (and anything that looks like a bearer token) from text that came back from a provider. */
export function redact(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey && apiKey.length >= 6) out = out.split(apiKey).join('•••');
  return out.replace(/\b(sk|gsk|AIza|sk-ant|sk-or)[-_A-Za-z0-9]{12,}/g, '•••');
}

const CONTEXT = /context.?length|context window|too many tokens|prompt is too long|maximum context|exceeds the (maximum|max)|input token count|reduce the length|request too large|too long/i;
const QUOTA = /quota|credit|billing|insufficient_quota|balance|payment|RESOURCE_EXHAUSTED.*(quota|billing)/i;
const AUTH = /api key not valid|invalid api key|invalid x-api-key|incorrect api key|unauthenticated|API_KEY_INVALID/i;
const MODEL = /model.*(not found|does not exist|not available|not supported|decommissioned|invalid)|unknown model|no such model|model_not_found/i;

/** Turns an HTTP error from a provider into an AiError with a useful message. */
export function classifyHttpError(provider: string, status: number, raw: string, apiKey?: string): AiError {
  const detail = redact(extractMessage(raw), apiKey).slice(0, 300);
  const said = detail ? ` The provider said: “${detail}”` : '';
  if (status === 401 || (status === 403 && !QUOTA.test(detail)) || (status === 400 && AUTH.test(detail))) {
    return new AiError('auth', `${provider} rejected the API key. Check that it is correct and still active.${said}`, status);
  }
  if (status === 402 || QUOTA.test(detail)) {
    return new AiError('quota', `${provider} says the account is out of credit or quota. Check billing on the provider's site.${said}`, status);
  }
  if (status === 429 || status === 529) {
    return new AiError('rate', `${provider} is rate-limiting or overloaded right now. Wait a moment and try again.${said}`, status);
  }
  if (status === 413 || CONTEXT.test(detail)) {
    return new AiError(
      'context',
      `The request is too long for this model's context window. Ask about a smaller part of the document or pick a model with a larger context.${said}`,
      status,
    );
  }
  if (status === 404 || MODEL.test(detail)) {
    return new AiError('model', `${provider} does not recognise that model. Pick another model in AI settings.${said}`, status);
  }
  if (status >= 500) return new AiError('server', `${provider} had a server error (${status}). Try again shortly.${said}`, status);
  return new AiError('bad-request', `${provider} refused the request (${status}).${said}`, status);
}

/** fetch() itself failed: offline, DNS, or the browser blocked the response (CORS). */
export function networkError(provider: ProviderId, label: string, host: string): AiError {
  const local =
    provider === 'custom'
      ? ' For a local server, make sure it is running and allows requests from this site (Ollama: set OLLAMA_ORIGINS to this site\'s address; LM Studio: turn on "Enable CORS").'
      : '';
  return new AiError(
    'network',
    `Could not reach ${label} (${host}). You may be offline, or the browser blocked the request (CORS).${local}`,
  );
}

function extractMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const json: unknown = JSON.parse(text);
    const pick = (v: unknown): string | undefined => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return pick(o.message) ?? pick(o.error) ?? pick(o.detail);
      }
      return undefined;
    };
    const first = Array.isArray(json) ? json[0] : json;
    return pick(first) ?? text;
  } catch {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
}
