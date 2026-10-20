/**
 * Streaming chat completion against the provider saved in extension settings.
 * Extension pages call this directly. The in-page grammar check still goes through the background script.
 */

import { browser } from 'wxt/browser';
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_PROVIDER, PROVIDER_CONFIG } from '~/lib/content/config';
import type { ApiProvider } from '~/lib/content/types';

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
      endpoint: `${base}/v1/chat/completions`,
    };
  }

  return {
    provider,
    providerName: config.name,
    model,
    endpoint: config.chatEndpoint,
  };
}

async function readErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return '';
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : '';
}

function messageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function deltaContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

async function readStream(response: Response, onDelta?: (text: string) => void): Promise<string> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json') || !response.body) {
    return messageContent(await response.json());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const delta = deltaContent(JSON.parse(data));
      if (!delta) return;
      full += delta;
      onDelta?.(delta);
    } catch {
      // Ignore a partial SSE line. The next chunk completes it.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(consumeLine);
  }
  if (buffer) consumeLine(buffer);
  return full;
}

export async function completeChat(input: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<string> {
  const resolved = await resolveProvider();
  const config = PROVIDER_CONFIG[resolved.provider];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

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

  let response: Response;
  try {
    response = await fetch(resolved.endpoint, {
      method: 'POST',
      headers,
      signal: input.signal,
      body: JSON.stringify({
        model: resolved.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 512,
        stream: true,
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ChatError(
      `Could not reach ${resolved.providerName} at ${resolved.endpoint}. If this is Ollama, confirm it is running.`,
      { provider: resolved.provider }
    );
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const ollamaBlocked = resolved.provider === 'ollama' && response.status === 403;
    const message = ollamaBlocked
      ? `Ollama refused the request (403). Allow extension origins and restart Ollama: OLLAMA_ORIGINS="${OLLAMA_ORIGINS_VALUE}"`
      : `${resolved.providerName} returned ${response.status}${detail ? `: ${detail}` : ''}.`;
    throw new ChatError(message, {
      status: response.status,
      provider: resolved.provider,
      ollamaBlocked,
    });
  }

  const text = await readStream(response, input.onDelta);
  if (!text.trim()) {
    throw new ChatError(`${resolved.providerName} returned an empty reply.`, {
      provider: resolved.provider,
    });
  }
  return text;
}
