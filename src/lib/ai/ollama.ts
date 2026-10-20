/**
 * Ollama's native chat API.
 * Grammar checks ask for a JSON object. Translation stays plain text.
 * `keep_alive` leaves the model loaded so the next check does not cold-start.
 */

export const OLLAMA_KEEP_ALIVE = '30m';
/**
 * llama3.2 otherwise loads a 32768 context. Prompt eval for that window is
 * expensive even when the passage is a sentence, and it shows up as high CPU
 * while the GPU is already busy.
 */
export const OLLAMA_NUM_CTX = 4096;
/** Grammar JSON is short. A hard cap keeps a slow generation from running on. */
export const OLLAMA_CHECK_MAX_TOKENS = 512;
/** A translation can be as long as the source, but not an open-ended completion. */
export const OLLAMA_TRANSLATE_MAX_TOKENS = 1024;

export interface OllamaChatMessage {
  role: string;
  content: string;
}

export interface OllamaChatBody {
  model: string;
  messages: OllamaChatMessage[];
  stream: false;
  keep_alive: string;
  format?: 'json';
  options: {
    temperature: number;
    num_ctx: number;
    num_predict: number;
  };
}

export function ollamaChatUrl(endpoint: string): string {
  const base = endpoint
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/, '')
    .replace(/\/api\/chat$/, '');
  return `${base}/api/chat`;
}

export function ollamaPredictTokens(kind: 'check' | 'translate', requested?: number): number {
  const cap = kind === 'translate' ? OLLAMA_TRANSLATE_MAX_TOKENS : OLLAMA_CHECK_MAX_TOKENS;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return cap;
  return Math.min(cap, Math.max(1, Math.floor(requested)));
}

export function buildOllamaChatBody(input: {
  model: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  kind?: 'check' | 'translate';
}): OllamaChatBody {
  const options: OllamaChatBody['options'] = {
    temperature: input.temperature ?? 0.2,
    num_ctx: OLLAMA_NUM_CTX,
    num_predict: ollamaPredictTokens(input.kind ?? 'check', input.maxTokens),
  };
  return {
    model: input.model,
    messages: input.messages,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    ...(input.json ? { format: 'json' as const } : {}),
    options,
  };
}
