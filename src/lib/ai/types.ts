export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'groq' | 'openrouter' | 'custom';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

/** Which provider, key and model a request goes to. Built from the saved settings. */
export type ProviderTarget = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** Only for the OpenAI-compatible provider ("http://localhost:11434/v1"). */
  baseUrl?: string;
};

export type ModelOption = {
  id: string;
  label?: string;
  /** Context window in tokens, when the provider's list says. */
  contextTokens?: number;
};

export type StopReason = 'end' | 'length' | 'refusal' | 'filtered' | 'unknown';

export type StreamResult = { text: string; stopReason: StopReason };

export type ChatOptions = {
  signal?: AbortSignal;
  /** Called with each new piece of text as it streams in. */
  onText?: (delta: string, full: string) => void;
  /** Upper bound for the answer, in tokens. */
  maxTokens?: number;
};
