/**
 * Ollama's native chat API.
 * Grammar checks ask for a JSON object. Translation stays plain text.
 * `keep_alive` leaves the model loaded so the next check does not cold-start.
 */

export const OLLAMA_KEEP_ALIVE = '30m';

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
    num_predict?: number;
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

export function buildOllamaChatBody(input: {
  model: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}): OllamaChatBody {
  const options: OllamaChatBody['options'] = {
    temperature: input.temperature ?? 0.2,
  };
  if (typeof input.maxTokens === 'number') options.num_predict = input.maxTokens;
  return {
    model: input.model,
    messages: input.messages,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    ...(input.json ? { format: 'json' as const } : {}),
    options,
  };
}
