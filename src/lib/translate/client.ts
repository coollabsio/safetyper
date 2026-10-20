/**
 * Popup translation client.
 * Reads the provider, model, and credentials already saved in Settings,
 * then sends the prompt through the background chat-completions path.
 */

import { browser } from 'wxt/browser';
import {
  CONFIG,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_PROVIDER,
  PROVIDER_CONFIG,
} from '../content/config';
import type { ApiProvider, CheckGrammarResponse } from '../content/types';
import { describeTranslateError } from './errors';
import { isAutoDetect, languageName } from './languages';
import { buildTranslationPayload, isSingleWord, parseTranslationResponse } from './prompt';
import type { TranslationResult } from './types';

export class TranslateError extends Error {
  readonly opensSettings: boolean;

  constructor(message: string, opensSettings = false) {
    super(message);
    this.name = 'TranslateError';
    this.opensSettings = opensSettings;
  }
}

interface ProviderSettings {
  provider: ApiProvider;
  model: string;
  endpoint: string;
  apiKey: string;
}

export async function translateText(
  text: string,
  sourceCode: string,
  targetCode: string
): Promise<TranslationResult> {
  if (!text.trim()) {
    throw new TranslateError('Enter a word or sentence to translate.');
  }
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    throw new TranslateError(
      `Text is too long (${text.length} characters). Maximum is ${CONFIG.MAX_TEXT_LENGTH}.`
    );
  }

  const settings = await readProviderSettings();
  assertProviderReady(settings);

  const payload = buildTranslationPayload({
    model: settings.model,
    text,
    sourceLanguageName: isAutoDetect(sourceCode) ? null : languageName(sourceCode),
    targetLanguageName: languageName(targetCode),
    singleWord: isSingleWord(text),
  });

  let response: CheckGrammarResponse;
  try {
    response = (await browser.runtime.sendMessage({
      action: 'translate',
      referer: window.location.href,
      payload,
    })) as CheckGrammarResponse;
  } catch (error) {
    throw toTranslateError(error, settings);
  }

  if (!response?.success) {
    throw toTranslateError(new Error(response?.error || 'Translation failed.'), settings);
  }

  const raw = response.data?.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw new TranslateError('The model returned an empty translation. Try again.');
  }

  const parsed = parseTranslationResponse(raw);
  if (!parsed.translation.trim()) {
    throw new TranslateError('The model returned an empty translation. Try again.');
  }
  if (!isSingleWord(text)) {
    parsed.alternatives = [];
  }
  return parsed;
}

function toTranslateError(error: unknown, settings: ProviderSettings): TranslateError {
  const described = describeTranslateError(error, settings.provider, settings.endpoint);
  return new TranslateError(described.message, described.opensSettings);
}

function assertProviderReady(settings: ProviderSettings): void {
  const config = PROVIDER_CONFIG[settings.provider];
  if (!config.requiresApiKey) return;

  if (!settings.apiKey.trim()) {
    throw new TranslateError(
      `Add your ${config.name} API key in Settings before translating.`,
      true
    );
  }
  if (!config.keyRegex.test(settings.apiKey.trim())) {
    throw new TranslateError(
      `The saved ${config.name} API key looks invalid. Update it in Settings.`,
      true
    );
  }
}

async function readProviderSettings(): Promise<ProviderSettings> {
  const stored = await browser.storage.local.get([
    'selectedProvider',
    'selectedModel',
    'groqSelectedModel',
    'ollamaSelectedModel',
    'openRouterKey',
    'groqKey',
    'ollamaEndpoint',
  ]);

  const provider = isProvider(stored.selectedProvider) ? stored.selectedProvider : DEFAULT_PROVIDER;
  const config = PROVIDER_CONFIG[provider];
  const storedModel = stored[config.modelStorageKey];
  const model = typeof storedModel === 'string' && storedModel ? storedModel : config.defaultModel;
  const endpoint =
    typeof stored.ollamaEndpoint === 'string' && stored.ollamaEndpoint
      ? stored.ollamaEndpoint
      : DEFAULT_OLLAMA_ENDPOINT;
  const storedKey = provider === 'ollama' ? '' : stored[config.keyStorageKey];
  const apiKey = typeof storedKey === 'string' ? storedKey : '';

  return { provider, model, endpoint, apiKey };
}

function isProvider(value: unknown): value is ApiProvider {
  return value === 'openrouter' || value === 'groq' || value === 'ollama';
}
