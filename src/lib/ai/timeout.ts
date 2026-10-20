/**
 * Request deadlines for provider calls.
 * Cloud chats use 60s. Ollama gets 120s so a cold model load can emit its first token.
 * A content-script watchdog is slightly longer, so a killed service worker still surfaces an error.
 */

import type { ApiProvider } from '../content/types';

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;
export const OLLAMA_LOADING_HINT_MS = 5_000;
export const MESSAGE_TIMEOUT_GRACE_MS = 5_000;
export const MODELS_TIMEOUT_MS = 20_000;

const OVERRIDE_KEY = '__SAFETYPER_TIMEOUT_MS';

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export function timeoutForProvider(provider: ApiProvider): number {
  const override = (globalThis as Record<string, unknown>)[OVERRIDE_KEY];
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 50 &&
    override <= OLLAMA_REQUEST_TIMEOUT_MS
  ) {
    return override;
  }
  return provider === 'ollama' ? OLLAMA_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

export function timeoutMessage(provider: ApiProvider): string {
  const seconds = Math.round(timeoutForProvider(provider) / 1000);
  if (provider === 'ollama') {
    return `The request timed out after ${seconds}s. Ollama may still be loading the model. Try again.`;
  }
  return `The request timed out after ${seconds}s. Try again.`;
}

export function isRequestTimeout(error: unknown): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError;
}

export function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Reject if `promise` is still pending after `timeoutMs`.
 * Used when a service-worker message channel dies without resolving.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createError());
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    timeoutMessage?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  const external = options.signal;
  const onExternal = (): void => {
    controller.abort();
  };
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternal, { once: true });
  }

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !external?.aborted) {
      throw new RequestTimeoutError(
        options.timeoutMessage ??
          `The request timed out after ${Math.round(options.timeoutMs / 1000)}s. Try again.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternal);
  }
}
