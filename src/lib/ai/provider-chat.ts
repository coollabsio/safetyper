/**
 * One chat completion against the saved provider.
 * Ollama uses native /api/chat. Other providers stay on their OpenAI-compatible endpoint.
 */

import type { ApiProvider } from '../content/types';
import { buildOllamaChatBody, ollamaChatUrl, type OllamaChatMessage } from './ollama';
import {
  fetchWithTimeout,
  isAbortError,
  isRequestTimeout,
  timeoutForProvider,
  timeoutMessage,
} from './timeout';

export interface ProviderChatInput {
  provider: ApiProvider;
  endpoint: string;
  headers?: Record<string, string>;
  model: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ollama checks set this so the model must return a JSON object. */
  json?: boolean;
  /** Selects the Ollama num_predict cap. Translation is larger than a check. */
  kind?: 'check' | 'translate';
  /** Forwarded as-is for OpenAI-compatible providers. Ollama builds its own body. */
  openAiBody?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function readAssistantContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const message = record.message;
  if (message && typeof message === 'object') {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  const choices = record.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return '';
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === 'string' ? content : '';
}

export function readProviderError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export async function runProviderChat(input: ProviderChatInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? timeoutForProvider(input.provider);
  const ollama = input.provider === 'ollama';
  const url = ollama ? ollamaChatUrl(input.endpoint) : input.endpoint;
  const body = ollama
    ? buildOllamaChatBody({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        json: input.json === true,
        kind: input.kind ?? 'check',
      })
    : (input.openAiBody ?? {
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        ...(typeof input.maxTokens === 'number' ? { max_tokens: input.maxTokens } : {}),
        stream: false,
      });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
      {
        timeoutMs,
        signal: input.signal,
        timeoutMessage: timeoutMessage(input.provider),
        fetchImpl: input.fetchImpl,
      }
    );
  } catch (error) {
    if (isRequestTimeout(error) || isAbortError(error)) throw error;
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readProviderError(payload);
    throw new Error(
      `API request failed with status ${response.status}${detail ? `: ${detail}` : ''}`
    );
  }
  return readAssistantContent(payload);
}
