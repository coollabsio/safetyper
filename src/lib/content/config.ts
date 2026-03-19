/**
 * Configuration constants for SafeTyper content script
 */

import type { ApiProvider, Config } from './types';

/**
 * Configuration constants
 */
export const CONFIG: Config = {
  // Debounce times in milliseconds
  DEBOUNCE_FAST: 50,
  DEBOUNCE_MEDIUM: 100,
  DEBOUNCE_SLOW: 200,

  // Typing speed thresholds in milliseconds
  TYPING_SPEED_FAST: 100,
  TYPING_SPEED_MEDIUM: 200,

  // Typing speed history size
  TYPING_HISTORY_SIZE: 10,

  // Icon dimensions and positioning
  ICON_SIZE: 24,
  ICON_OFFSET: 30,

  // Delays
  BLUR_DELAY: 200,

  // Text limits
  MAX_TEXT_LENGTH: 5000,
};

/**
 * Default LLM model
 */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

/**
 * Default API provider
 */
export const DEFAULT_PROVIDER: ApiProvider = 'openrouter';

/**
 * Provider-specific configuration
 */
export const PROVIDER_CONFIG = {
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'google/gemini-2.5-flash',
    chatEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    modelsEndpoint: 'https://openrouter.ai/api/v1/models',
    keyPrefix: 'sk-or-v1-',
    keyRegex: /^sk-or-v1-[a-f0-9]{64}$/,
    keyStorageKey: 'openRouterKey' as const,
    modelStorageKey: 'selectedModel' as const,
    cachedModelsStorageKey: 'cachedModels' as const,
    keysUrl: 'https://openrouter.ai/keys',
    requiresReferer: true,
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    keyPrefix: 'gsk_',
    keyRegex: /^gsk_[A-Za-z0-9]{48,}$/,
    keyStorageKey: 'groqKey' as const,
    modelStorageKey: 'groqSelectedModel' as const,
    cachedModelsStorageKey: 'groqCachedModels' as const,
    keysUrl: 'https://console.groq.com/keys',
    requiresReferer: false,
  },
} as const satisfies Record<ApiProvider, object>;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  MAX_SIZE: 50,
  TTL: 5 * 60 * 1000, // 5 minutes
};
