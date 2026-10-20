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
import {
  applySuggestions,
  locateSuggestions,
  parseModelIssues,
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
 * Generate cache key from text
 */
function getCacheKey(text: string, model: string, prompt: string): string {
  return `${model}:${prompt.substring(0, 32)}:${text}`;
}

/**
 * Check grammar using OpenRouter API
 */
export interface GrammarCheckResult {
  correctedText: string;
  suggestions: Suggestion[];
}

export class GrammarCheckCancelled extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'GrammarCheckCancelled';
  }
}

export async function checkGrammar(text: string, requestId?: string): Promise<GrammarCheckResult> {
  // Validate text length
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    throw new Error(
      `Text is too long (${text.length} characters). Maximum allowed is ${CONFIG.MAX_TEXT_LENGTH} characters.`
    );
  }

  // Get selected model from storage (provider-aware)
  const result = await browser.storage.local.get([
    'selectedProvider',
    'selectedModel',
    'groqSelectedModel',
    'ollamaSelectedModel',
    'customSystemPrompt',
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

  const systemPrompt =
    (typeof result.customSystemPrompt === 'string' && result.customSystemPrompt) ||
    DEFAULT_SYSTEM_PROMPT;

  // Check cache first
  const cacheKey = getCacheKey(text, model, systemPrompt);
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Using cached grammar check result');
    }
    return {
      correctedText: cachedResult.correctedText,
      suggestions: readCachedSuggestions(text, cachedResult),
    };
  }

  // Prepare API request payload
  const payload: OpenRouterRequestPayload = {
    model,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `Please fix the grammar and spelling in this text while preserving EXACTLY the same formatting, line breaks, and structure as the original:\n\n${text}`,
      },
    ],
    temperature: 0.2,
    response_format: { type: 'text' },
  };

  if (systemPrompt === DEFAULT_SYSTEM_PROMPT) {
    payload.messages[1] = { role: 'user', content: text };
  }

  // Send request to background script
  const message: CheckGrammarMessage = {
    action: 'checkGrammar',
    referer: window.location.href,
    payload,
    requestId,
  };

  const response = (await browser.runtime.sendMessage(message)) as CheckGrammarResponse;

  if (!response?.success) {
    if (response?.cancelled) throw new GrammarCheckCancelled();
    throw new Error(response?.error || 'Unknown error occurred');
  }

  let correctedText = text;
  let suggestions: Suggestion[] = [];
  const raw = response.data?.choices?.[0]?.message?.content;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const issues = parseModelIssues(raw);
    if (issues) {
      suggestions = locateSuggestions(text, issues);
      correctedText = applySuggestions(text, suggestions);
    } else {
      let trimmedCorrected = raw.trim();
      if (trimmedCorrected.startsWith('"') && trimmedCorrected.endsWith('"')) {
        trimmedCorrected = trimmedCorrected.slice(1, -1);
      }
      correctedText = trimmedCorrected;
      suggestions = suggestionsFromDiff(text, correctedText);
    }
  }

  cache.set(cacheKey, correctedText, JSON.stringify(suggestions));

  return { correctedText, suggestions };
}

function readCachedSuggestions(text: string, entry: CacheEntry): Suggestion[] {
  try {
    const parsed = JSON.parse(entry.suggestionsJson || '[]') as unknown;
    if (Array.isArray(parsed)) return parsed as Suggestion[];
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
