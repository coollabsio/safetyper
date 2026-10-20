/**
 * User-facing translation errors.
 * Network and provider failures stay specific; missing keys point at Settings.
 */

import type { ApiProvider } from '../content/types';
import { PROVIDER_CONFIG } from '../content/config';

export interface TranslateErrorInfo {
  message: string;
  opensSettings: boolean;
}

export function describeTranslateError(
  error: unknown,
  provider: ApiProvider,
  endpoint?: string
): TranslateErrorInfo {
  const message = error instanceof Error ? error.message : 'Translation failed.';
  const lower = message.toLowerCase();
  const providerName = PROVIDER_CONFIG[provider].name;

  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('message port closed')
  ) {
    return {
      message: message.includes('timed out')
        ? message
        : 'The request timed out before the model responded. Try again.',
      opensSettings: false,
    };
  }

  if (lower.includes('rate limit')) {
    return {
      message: 'Too many requests. Wait a moment, then try again.',
      opensSettings: false,
    };
  }

  if (lower.includes('api key not configured') || lower.includes('not configured')) {
    return {
      message: `Add your ${providerName} API key in Settings before translating.`,
      opensSettings: true,
    };
  }

  if (lower.includes('invalid') && lower.includes('api key')) {
    return {
      message: `The saved ${providerName} API key looks invalid. Update it in Settings.`,
      opensSettings: true,
    };
  }

  if (provider === 'ollama' && isUnreachable(lower)) {
    const where = endpoint ? ` at ${endpoint}` : '';
    return {
      message: `Can't reach Ollama${where}. Check the endpoint in Settings, then try again.`,
      opensSettings: true,
    };
  }

  if (provider === 'ollama' && isForbidden(lower)) {
    return {
      message: 'Ollama refused the request (403). Check the endpoint in Settings, then try again.',
      opensSettings: true,
    };
  }

  return { message, opensSettings: false };
}

function isForbidden(message: string): boolean {
  return message.includes('status 403') || message.includes('http 403') || /\b403\b/.test(message);
}

function isUnreachable(message: string): boolean {
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('econnrefused') ||
    message.includes('connection refused') ||
    message.includes('connection failed') ||
    message.includes('aborted')
  );
}
