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

  // Selection
  SELECTION_DEBOUNCE: 250,
  MIN_SELECTION_LENGTH: 3,

  // Pause after typing, then check. Long enough to avoid a request per keystroke.
  AUTO_CHECK_DEBOUNCE: 1750,
  AUTO_CHECK_MIN_CHARS: 12,
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
 * Default Ollama endpoint
 */
export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

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
    requiresApiKey: true,
  },
  groq: {
    name: 'Groq',
    defaultModel: 'openai/gpt-oss-120b',
    chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    keyPrefix: 'gsk_',
    keyRegex: /^gsk_[A-Za-z0-9]{48,}$/,
    keyStorageKey: 'groqKey' as const,
    modelStorageKey: 'groqSelectedModel' as const,
    cachedModelsStorageKey: 'groqCachedModels' as const,
    keysUrl: 'https://console.groq.com/keys',
    requiresReferer: false,
    requiresApiKey: true,
  },
  ollama: {
    name: 'Ollama',
    defaultModel: 'llama3.2',
    chatEndpoint: 'http://localhost:11434/v1/chat/completions',
    modelsEndpoint: 'http://localhost:11434/api/tags',
    keyPrefix: '',
    keyRegex: /.*/,
    keyStorageKey: 'ollamaEndpoint' as const,
    modelStorageKey: 'ollamaSelectedModel' as const,
    cachedModelsStorageKey: 'ollamaCachedModels' as const,
    keysUrl: '',
    requiresReferer: false,
    requiresApiKey: false,
  },
} as const satisfies Record<ApiProvider, object>;

/**
 * Default system prompt for grammar checking
 */
export const DEFAULT_SYSTEM_PROMPT = [
  'You are a proofreading assistant. Find grammar, spelling, punctuation, clarity, and style problems.',
  'Reply with one JSON object and nothing else:',
  '{"issues":[{"quote":"exact substring from the passage","replacement":"corrected substring","category":"grammar|spelling|punctuation|clarity|style","explanation":"one short sentence"}]}',
  'Rules:',
  '- quote is a short exact copy from the passage, usually one to six words.',
  '- replacement is only those words, corrected.',
  '- Return at most 8 issues.',
  '- If nothing is wrong, return {"issues":[]}.',
  '- Always respond in the SAME language as the input text. Do not translate.',
  '- Do not wrap the JSON in markdown.',
].join('\n');

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  MAX_SIZE: 50,
  TTL: 5 * 60 * 1000, // 5 minutes
};
