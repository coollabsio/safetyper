/**
 * Configuration constants for SafeTyper content script
 */

import type { Config } from './types';

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
 * Cache configuration
 */
export const CACHE_CONFIG = {
  MAX_SIZE: 50,
  TTL: 5 * 60 * 1000, // 5 minutes
};
