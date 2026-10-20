/**
 * Streaming chat completion against the provider saved in extension settings.
 * Extension pages call this directly. The in-page grammar check still goes through the background script.
 */

import { browser } from 'wxt/browser';
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_PROVIDER, PROVIDER_CONFIG } from '~/lib/content/config';
import type { ApiProvider } from '~/lib/content/types';
import { OllamaFlight } from './ollama-flight';
import { runProviderChat } from './provider-chat';
import { isAbortError, isRequestTimeout } from './timeout';

const editorFlight = new OllamaFlight();

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResolvedProvider {
  provider: ApiProvider;
  providerName: string;
  model: string;
  endpoint: string;
}

export class ChatError extends Error {
  readonly status: number | null;
  readonly provider: ApiProvider | null;
  readonly ollamaBlocked: boolean;

  constructor(
    message: string,
    options: {
      status?: number | null;
      provider?: ApiProvider | null;
      ollamaBlocked?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'ChatError';
    this.status = options.status ?? null;
    this.provider = options.provider ?? null;
    this.ollamaBlocked = options.ollamaBlocked ?? false;
  }
}

export const OLLAMA_ORIGINS_VALUE = 'chrome-extension://*,moz-extension://*';

function isProvider(value: unknown): value is ApiProvider {
  return typeof value === 'string' && value in PROVIDER_CONFIG;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export async function resolveProvider(): Promise<ResolvedProvider> {
  const stored = await browser.storage.local.get([
    'selectedProvider',
    'selectedModel',
    'groqSelectedModel',
    'ollamaSelectedModel',
    'ollamaEndpoint',
  ]);
  const provider = isProvider(stored.selectedProvider) ? stored.selectedProvider : DEFAULT_PROVIDER;
  const config = PROVIDER_CONFIG[provider];
  const model = stringSetting(stored[config.modelStorageKey], config.defaultModel);

  if (provider === 'ollama') {
    const base = stringSetting(stored.ollamaEndpoint, DEFAULT_OLLAMA_ENDPOINT).replace(/\/+$/, '');
    return {
      provider,
      providerName: config.name,
      model,
      endpoint: base,
    };
  }

  return {
    provider,
    providerName: config.name,
    model,
    endpoint: config.chatEndpoint,
  };
}

export async function completeChat(input: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Ask Ollama to return a JSON object. Translation leaves this unset. */
  json?: boolean;
}): Promise<string> {
  const resolved = await resolveProvider();
  const config = PROVIDER_CONFIG[resolved.provider];
  const headers: Record<string, string> = {};

  if (config.requiresApiKey) {
    const stored = await browser.storage.local.get([config.keyStorageKey]);
    const apiKey = stored[config.keyStorageKey];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new ChatError(`${config.name} API key is not configured.`, {
        provider: resolved.provider,
      });
    }
    if (!config.keyRegex.test(apiKey)) {
      throw new ChatError(`Invalid ${config.name} API key format.`, {
        provider: resolved.provider,
      });
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (config.requiresReferer) {
    headers['HTTP-Referer'] = browser.runtime.getURL('/editor.html');
  }

  const owned = editorFlight.start('editor', 'editor');
  const followCaller = (): void => {
    owned.abort();
  };
  if (input.signal?.aborted) owned.abort();
  else input.signal?.addEventListener('abort', followCaller, { once: true });

  let text = '';
  try {
    text = await runProviderChat({
      provider: resolved.provider,
      endpoint: resolved.endpoint,
      headers,
      model: resolved.model,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens ?? 512,
      json: input.json === true && resolved.provider === 'ollama',
      kind: 'check',
      signal: owned.signal,
    });
  } catch (error) {
    if (isAbortError(error) || isRequestTimeout(error)) throw error;
    const status = readStatus(error);
    const detail = error instanceof Error ? error.message : '';
    const ollamaBlocked = resolved.provider === 'ollama' && status === 403;
    if (ollamaBlocked) {
      throw new ChatError(
        `Ollama refused the request (403). Allow extension origins and restart Ollama: OLLAMA_ORIGINS="${OLLAMA_ORIGINS_VALUE}"`,
        { status, provider: resolved.provider, ollamaBlocked: true }
      );
    }
    if (status) {
      throw new ChatError(detail || `${resolved.providerName} returned ${status}.`, {
        status,
        provider: resolved.provider,
      });
    }
    throw new ChatError(
      `Could not reach ${resolved.providerName} at ${resolved.endpoint}. If this is Ollama, confirm it is running.`,
      { provider: resolved.provider }
    );
  } finally {
    input.signal?.removeEventListener('abort', followCaller);
    editorFlight.finish('editor', 'editor', owned);
  }

  if (!text.trim()) {
    throw new ChatError(`${resolved.providerName} returned an empty reply.`, {
      provider: resolved.provider,
    });
  }
  return text;
}

function readStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/status (\d+)/);
  if (!match) return null;
  return Number(match[1]);
}
