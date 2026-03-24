/**
 * Type definitions for SafeTyper content script
 */

/**
 * Supported API providers
 */
export type ApiProvider = 'openrouter' | 'groq' | 'ollama';

/**
 * OpenRouter API Message
 */
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenRouter API Request Payload
 */
export interface OpenRouterRequestPayload {
  model: string;
  messages: OpenRouterMessage[];
  temperature: number;
  response_format?: { type: string };
}

/**
 * OpenRouter API Response
 */
export interface OpenRouterResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

/**
 * Browser runtime message for grammar check
 */
export interface CheckGrammarMessage {
  action: 'checkGrammar';
  referer: string;
  payload: OpenRouterRequestPayload;
}

/**
 * Browser runtime response for grammar check
 */
export interface CheckGrammarResponse {
  success: boolean;
  data?: OpenRouterResponse;
  error?: string;
}

/**
 * OpenRouter model from the API
 */
export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
}

/**
 * Cached models data with timestamp
 */
export interface CachedModelsData {
  models: OpenRouterModel[];
  fetchedAt: number;
}

/**
 * Storage schema for extension settings
 */
export interface StorageSchema {
  selectedProvider?: ApiProvider;
  openRouterKey?: string;
  selectedModel?: string;
  cachedModels?: CachedModelsData;
  groqKey?: string;
  groqSelectedModel?: string;
  groqCachedModels?: CachedModelsData;
  ollamaEndpoint?: string;
  ollamaSelectedModel?: string;
  ollamaCachedModels?: CachedModelsData;
  darkMode?: boolean;
  hasCompletedOnboarding?: boolean;
  customSystemPrompt?: string;
}

/**
 * Diff operation type
 */
export type DiffOperationType = 'equal' | 'insert' | 'delete';

/**
 * Diff operation
 */
export interface DiffOperation {
  type: DiffOperationType;
  text: string;
}

/**
 * Word group for diff display
 */
export interface WordGroup {
  original: string[];
  corrected: string[];
}

/**
 * Position coordinates
 */
export interface Position {
  left: number;
  top: number;
}

/**
 * Content script state
 */
export interface ContentScriptState {
  activeInput: HTMLElement | null;
  iconContainer: HTMLDivElement | null;
  popup: HTMLDivElement | null;
  typingTimer: number | null;
  isTyping: boolean;
  isComposing: boolean;
  lastTypingTime: number;
  typingSpeedHistory: number[];
  cachedPosition: Position | null;
  lastInputRect: DOMRect | null;
}

/**
 * Configuration constants
 */
export interface Config {
  DEBOUNCE_FAST: number;
  DEBOUNCE_MEDIUM: number;
  DEBOUNCE_SLOW: number;
  TYPING_SPEED_FAST: number;
  TYPING_SPEED_MEDIUM: number;
  TYPING_HISTORY_SIZE: number;
  ICON_SIZE: number;
  ICON_OFFSET: number;
  BLUR_DELAY: number;
  MAX_TEXT_LENGTH: number;
}

/**
 * Cache entry for API responses
 */
export interface CacheEntry {
  correctedText: string;
  timestamp: number;
}

/**
 * API cache
 */
export interface ApiCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, value: string): void;
  clear(): void;
  size(): number;
}
