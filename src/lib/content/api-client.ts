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
import { CACHE_CONFIG, CONFIG, DEFAULT_PROVIDER, PROVIDER_CONFIG } from './config';

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

  set(key: string, value: string): void {
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
function getCacheKey(text: string, model: string): string {
  return `${model}:${text}`;
}

/**
 * Check grammar using OpenRouter API
 */
export async function checkGrammar(text: string): Promise<string> {
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
  ]);
  const provider: ApiProvider = result.selectedProvider || DEFAULT_PROVIDER;
  let model: string;
  if (provider === 'openrouter') {
    model = result.selectedModel || PROVIDER_CONFIG.openrouter.defaultModel;
  } else if (provider === 'groq') {
    model = result.groqSelectedModel || PROVIDER_CONFIG.groq.defaultModel;
  } else {
    model = result.ollamaSelectedModel || PROVIDER_CONFIG.ollama.defaultModel;
  }

  // Check cache first
  const cacheKey = getCacheKey(text, model);
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Using cached grammar check result');
    }
    return cachedResult.correctedText;
  }

  // Prepare API request payload
  const payload: OpenRouterRequestPayload = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a grammar checking assistant. Fix grammar and spelling errors in the provided text. Return ONLY the corrected text with EXACTLY the same formatting, line breaks, paragraphs, and whitespace as the original. Do not add, remove, or modify any line breaks, indentation, spacing, or paragraph structure. Preserve every newline character and whitespace character exactly as they appear in the original. Do not wrap the response in quotes or add any prefixes or explanations.',
      },
      {
        role: 'user',
        content: `Please fix the grammar and spelling in this text while preserving EXACTLY the same formatting, line breaks, and structure as the original: "${text}"`,
      },
    ],
    temperature: 0.3,
    response_format: { type: 'text' },
  };

  // Send request to background script
  const message: CheckGrammarMessage = {
    action: 'checkGrammar',
    referer: window.location.href,
    payload,
  };

  const response = (await browser.runtime.sendMessage(message)) as CheckGrammarResponse;

  if (!response.success) {
    throw new Error(response.error || 'Unknown error occurred');
  }

  // Extract corrected text from response
  let correctedText = text;
  if (response.data?.choices && response.data.choices.length > 0) {
    const choice = response.data.choices[0];
    if (choice.message && choice.message.content) {
      const rawCorrected = choice.message.content;
      const trimmedCorrected = rawCorrected.trim();

      // Preserve line structure if possible
      const originalLines = text.split('\n');
      const correctedLines = trimmedCorrected.split('\n');

      if (originalLines.length === correctedLines.length) {
        correctedText = trimmedCorrected;
      } else {
        correctedText = trimmedCorrected;
      }
    }
  }

  // Cache the result
  cache.set(cacheKey, correctedText);

  return correctedText;
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
