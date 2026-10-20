/**
 * API client for OpenRouter grammar checking
 */

import { browser } from 'wxt/browser';
import type {
  ApiProvider,
  CheckGrammarMessage,
  CheckGrammarResponse,
  OpenRouterRequestPayload,
  CacheEntry,
  ApiCache,
} from './types';
import {
  CACHE_CONFIG,
  CONFIG,
  DEFAULT_PROVIDER,
  DEFAULT_SYSTEM_PROMPT,
  PROVIDER_CONFIG,
} from './config';
import { composeSystemPrompt, parseWritingGoals, WRITING_GOALS_STORAGE_KEY } from '../goals';
import {
  DISABLED_GROUPS_KEY,
  filterSuggestions,
  PERSONAL_DICTIONARY_KEY,
  readDictionary,
  readDisabledGroups,
  systemPromptWithDictionary,
} from './preferences';
import { parseRewrite, rewriteOption, rewriteSystemPrompt, type RewriteOptionId } from '../rewrite';
import {
  MESSAGE_TIMEOUT_GRACE_MS,
  RequestTimeoutError,
  timeoutForProvider,
  timeoutMessage,
  withTimeout,
} from '../ai/timeout';
import { interpretCheckReply } from './check-result';
import {
  applySuggestions,
  hydrateSuggestion,
  suggestionsFromDiff,
  type Suggestion,
} from './suggestions';

/**
 * Simple cache implementation for API responses
 */
class SimpleCache implements ApiCache {
  private cache: Map<string, CacheEntry> = new Map();

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if entry has expired
    if (Date.now() - entry.timestamp > CACHE_CONFIG.TTL) {
      this.cache.delete(key);
      return undefined;
    }

    return entry;
  }

  set(key: string, value: string, suggestionsJson = '[]'): void {
    // Enforce cache size limit
    if (this.cache.size >= CACHE_CONFIG.MAX_SIZE) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      correctedText: value,
      suggestionsJson,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global cache instance
const cache = new SimpleCache();

/**
 * Generate cache key from text. The full prompt is included so a goals change
 * cannot reuse a check or rewrite made for different goals.
 */
function getCacheKey(kind: string, text: string, model: string, prompt: string): string {
  return `${kind}:${model}:${prompt}:${text}`;
}

export interface GrammarCheckResult {
  correctedText: string;
  suggestions: Suggestion[];
  /** Suggestions removed by the dictionary or a turned-off group. */
  hiddenCount: number;
}

export class GrammarCheckCancelled extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'GrammarCheckCancelled';
  }
}

function assertWithinLimit(text: string): void {
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    throw new Error(
      `Text is too long (${text.length} characters). Maximum allowed is ${CONFIG.MAX_TEXT_LENGTH} characters.`
    );
  }
}

interface ModelContext {
  provider: ApiProvider;
  model: string;
  basePrompt: string;
  usingCustomPrompt: boolean;
  goals: ReturnType<typeof parseWritingGoals>;
}

async function loadModelContext(): Promise<ModelContext> {
  const result = await browser.storage.local.get([
    'selectedProvider',
    'selectedModel',
    'groqSelectedModel',
    'ollamaSelectedModel',
    'customSystemPrompt',
    WRITING_GOALS_STORAGE_KEY,
  ]);
  const provider: ApiProvider =
    (typeof result.selectedProvider === 'string' &&
      result.selectedProvider in PROVIDER_CONFIG &&
      (result.selectedProvider as ApiProvider)) ||
    DEFAULT_PROVIDER;
  const storedModel =
    provider === 'openrouter'
      ? result.selectedModel
      : provider === 'groq'
        ? result.groqSelectedModel
        : result.ollamaSelectedModel;
  const model =
    (typeof storedModel === 'string' && storedModel) || PROVIDER_CONFIG[provider].defaultModel;
  const custom =
    typeof result.customSystemPrompt === 'string' ? result.customSystemPrompt.trim() : '';
  return {
    provider,
    model,
    basePrompt: custom || DEFAULT_SYSTEM_PROMPT,
    usingCustomPrompt: custom.length > 0,
    goals: parseWritingGoals(result[WRITING_GOALS_STORAGE_KEY]),
  };
}

/**
 * Forward a chat-completions payload through the background script.
 * That path is the rate limiter (10 requests per minute) for checks and rewrites.
 */
async function requestCompletion(
  provider: ApiProvider,
  model: string,
  systemPrompt: string,
  user: string,
  temperature: number,
  requestId?: string
): Promise<string> {
  const id =
    requestId || `check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: OpenRouterRequestPayload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: user },
    ],
    temperature,
    response_format: { type: 'text' },
  };
  const message: CheckGrammarMessage = {
    action: 'checkGrammar',
    referer: window.location.href,
    payload,
    requestId: id,
  };
  let response: CheckGrammarResponse;
  try {
    response = await withTimeout(
      browser.runtime.sendMessage(message) as Promise<CheckGrammarResponse>,
      timeoutForProvider(provider) + MESSAGE_TIMEOUT_GRACE_MS,
      () => new RequestTimeoutError(timeoutMessage(provider))
    );
  } catch (error) {
    void browser.runtime
      .sendMessage({ action: 'cancelGrammarCheck', requestId: id })
      .catch((cancelError: unknown) => {
        console.error('[SafeTyper] Failed to cancel a grammar check:', cancelError);
      });
    if (error instanceof RequestTimeoutError) throw error;
    const detail = error instanceof Error ? error.message : 'Unknown error occurred';
    if (/message port closed|receiving end does not exist/i.test(detail)) {
      throw new RequestTimeoutError(timeoutMessage(provider));
    }
    throw error instanceof Error ? error : new Error(detail);
  }
  if (!response?.success) {
    if (response?.cancelled) throw new GrammarCheckCancelled();
    throw new Error(response?.error || 'Unknown error occurred');
  }
  const raw = response.data?.choices?.[0]?.message?.content;
  return typeof raw === 'string' ? raw : '';
}

/**
 * Check grammar using the selected provider.
 * `requestId` lets check-as-you-type cancel this call.
 */
function presentSuggestions(
  text: string,
  suggestions: Suggestion[],
  dictionary: readonly string[],
  disabledGroups: readonly string[]
): GrammarCheckResult {
  const filtered = filterSuggestions(suggestions, { dictionary, disabledGroups });
  return {
    suggestions: filtered,
    correctedText: applySuggestions(text, filtered),
    hiddenCount: suggestions.length - filtered.length,
  };
}

export async function checkGrammar(text: string, requestId?: string): Promise<GrammarCheckResult> {
  assertWithinLimit(text);
  const context = await loadModelContext();
  const stored = await browser.storage.local.get([PERSONAL_DICTIONARY_KEY, DISABLED_GROUPS_KEY]);
  const dictionary = readDictionary(stored[PERSONAL_DICTIONARY_KEY]);
  const disabledGroups = readDisabledGroups(stored[DISABLED_GROUPS_KEY]);
  const systemPrompt = systemPromptWithDictionary(
    composeSystemPrompt(context.basePrompt, context.goals),
    dictionary
  );

  const cacheKey = getCacheKey('check', text, context.model, systemPrompt);
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Using cached grammar check result');
    }
    return presentSuggestions(
      text,
      readCachedSuggestions(text, cachedResult),
      dictionary,
      disabledGroups
    );
  }

  const user = context.usingCustomPrompt
    ? `Please fix the grammar and spelling in this text while preserving EXACTLY the same formatting, line breaks, and structure as the original:\n\n${text}`
    : text;
  const raw = await requestCompletion(
    context.provider,
    context.model,
    systemPrompt,
    user,
    0.2,
    requestId
  );
  const interpreted = interpretCheckReply(text, raw);
  const { correctedText, suggestions } = interpreted;

  cache.set(cacheKey, correctedText, JSON.stringify(suggestions));

  return presentSuggestions(text, suggestions, dictionary, disabledGroups);
}

/**
 * Rewrite the passage with one preset. Uses the same 5,000-character limit
 * and the same background rate limiter as a grammar check.
 */
export async function rewritePassage(text: string, optionId: RewriteOptionId): Promise<string> {
  assertWithinLimit(text);
  const option = rewriteOption(optionId);
  if (!option) throw new Error('That rewrite is not available.');

  const context = await loadModelContext();
  const systemPrompt = composeSystemPrompt(rewriteSystemPrompt(option), context.goals);
  const cacheKey = getCacheKey(`rewrite:${option.id}`, text, context.model, systemPrompt);
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) return cachedResult.correctedText;

  const raw = await requestCompletion(context.provider, context.model, systemPrompt, text, 0.3);
  const rewritten = parseRewrite(raw);
  if (!rewritten) throw new Error('The rewrite did not come back in a usable form.');

  cache.set(cacheKey, rewritten);
  return rewritten;
}

function readCachedSuggestions(text: string, entry: CacheEntry): Suggestion[] {
  try {
    const parsed = JSON.parse(entry.suggestionsJson || '[]') as unknown;
    if (Array.isArray(parsed)) {
      const hydrated = parsed
        .map((item) => hydrateSuggestion(item))
        .filter((item): item is Suggestion => item !== null);
      if (hydrated.length > 0 || parsed.length === 0) return hydrated;
    }
  } catch {
    // Fall through and rebuild cards from the cached corrected text.
  }
  return suggestionsFromDiff(text, entry.correctedText);
}

/**
 * Clear the API cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache size
 */
export function getCacheSize(): number {
  return cache.size();
}
