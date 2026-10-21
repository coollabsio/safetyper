import type { ApiProvider } from '@/lib/content/types';
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_PROVIDER, PROVIDER_CONFIG } from '@/lib/content/config';
import {
  consumeTokenBudget,
  estimateTokens,
  refundTokenSpend,
  type TokenSpend,
} from '@/lib/content/budget';
import { installSelectionTranslate } from '@/lib/selection-translate/background';
import { featureForRequest, OllamaFlight } from '@/lib/ai/ollama-flight';
import { runProviderChat } from '@/lib/ai/provider-chat';
import {
  isAbortError,
  isRequestTimeout,
  MODELS_TIMEOUT_MS,
  timeoutMessage,
} from '@/lib/ai/timeout';
import {
  CONTENT_SCRIPT_EXCLUDE_MATCHES,
  isFrameStyleFile,
  sameMatchList,
} from '@/lib/content/page-guard';

// Groq models shut down by Groq (https://console.groq.com/docs/deprecations)
const REMOVED_GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'mixtral-8x7b-32768',
];

export default defineBackground(() => {
  installSelectionTranslate();
  console.log('Background script initialized', { id: browser.runtime.id });

  // Register content scripts on install/startup (dev mode fix)
  let registrationInProgress = false;

  async function registerContentScripts() {
    // Prevent concurrent registrations
    if (registrationInProgress) {
      console.log('[Background] Registration already in progress, skipping...');
      return;
    }

    registrationInProgress = true;

    try {
      // In dev mode, WXT doesn't automatically register content scripts in the manifest
      // So we need to register them programmatically
      const scripts = await browser.scripting.getRegisteredContentScripts();
      const scriptId = 'wxt:content-scripts/content.js';
      const existingScript = scripts.find(
        (script) =>
          script.id === scriptId || (script.js ?? []).some((file) => file.includes('content.js'))
      );

      const excludes = [...CONTENT_SCRIPT_EXCLUDE_MATCHES];
      const current =
        existingScript?.allFrames !== true &&
        (existingScript?.css ?? []).length === 0 &&
        sameMatchList(existingScript?.excludeMatches, excludes);
      if (existingScript && current) {
        console.log('[Background] Content script already registered, skipping');
      } else {
        if (existingScript?.id) {
          await browser.scripting.unregisterContentScripts({ ids: [existingScript.id] });
        }
        console.log('[Background] Registering content script...');
        await browser.scripting.registerContentScripts([
          {
            id: existingScript?.id ?? scriptId,
            matches: ['<all_urls>'],
            excludeMatches: excludes,
            // Styles are injected after the frame guard. Listing CSS here would
            // push the stylesheet into every matching document, including captcha frames.
            js: ['content-scripts/content.js'],
            runAt: 'document_idle',
            allFrames: false,
          },
        ]);
        console.log('[Background] ✅ Content script registered successfully');
      }
    } catch (error: any) {
      // If error is about duplicate, that's actually fine - means it's already registered
      if (error?.message && error.message.includes('Duplicate script ID')) {
        console.log('[Background] Content script already registered (duplicate error caught)');
      } else {
        console.error('[Background] Failed to register content script:', error);
      }
    } finally {
      registrationInProgress = false;
    }
  }

  // Helper to reload all tabs after content script registration
  async function reloadAllTabs() {
    try {
      const tabs = await browser.tabs.query({});
      console.log(`[Background] Reloading ${tabs.length} tabs...`);

      for (const tab of tabs) {
        if (
          tab.id &&
          tab.url &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://')
        ) {
          try {
            await browser.tabs.reload(tab.id);
          } catch (err) {
            // Tab might be closed or not reloadable, skip
          }
        }
      }
      console.log('[Background] Tabs reloaded');
    } catch (error) {
      console.error('[Background] Failed to reload tabs:', error);
    }
  }

  // Only register on install (first time or update)
  browser.runtime.onInstalled.addListener(async (details) => {
    console.log('[Background] Extension installed/updated');
    await registerContentScripts();
    await reloadAllTabs();

    // Reset Groq models that Groq has shut down, so the current default is used
    if (details.reason === 'update') {
      const { groqSelectedModel } = await browser.storage.local.get(['groqSelectedModel']);
      if (
        typeof groqSelectedModel === 'string' &&
        REMOVED_GROQ_MODELS.includes(groqSelectedModel)
      ) {
        await browser.storage.local.remove(['groqSelectedModel', 'groqCachedModels']);
      }
    }

    // Open onboarding on first install only
    if (details.reason === 'install') {
      const stored = await browser.storage.local.get(['hasCompletedOnboarding']);
      if (!stored.hasCompletedOnboarding) {
        browser.tabs.create({
          url: browser.runtime.getURL('/onboarding.html'),
        });
      }
    }
  });

  // Also register immediately on background script load (for dev mode reload)
  registerContentScripts().then(() => {
    console.log('[Background] Initial registration complete');
  });

  // Note: Extension pages (like test.html) load the content script directly via <script> tag
  // This is because Chrome doesn't allow programmatic injection into chrome-extension:// URLs

  // Rate limiting: Track API requests per minute
  const RATE_LIMIT = 10; // Maximum requests per minute
  const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds
  interface RateStamp {
    at: number;
  }
  const requestTimestamps: RateStamp[] = [];
  let tokenLog: TokenSpend[] = [];
  const inflightChecks = new Map<
    string,
    { controller: AbortController; rateStamp: RateStamp | null; spend: TokenSpend | null }
  >();
  const flights = new OllamaFlight();
  let activeChats = 0;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // Chrome can stop an MV3 worker during a long fetch and drop the message port.
  // A pending chat holds the worker awake until sendResponse runs.
  function holdWorker(): void {
    activeChats += 1;
    if (keepAliveTimer) return;
    const ping = (): void => {
      void browser.runtime.getPlatformInfo().catch(() => undefined);
    };
    ping();
    keepAliveTimer = setInterval(ping, 20_000);
  }

  function releaseWorker(): void {
    activeChats = Math.max(0, activeChats - 1);
    if (activeChats === 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function checkRateLimit(): { allowed: boolean; remaining: number; stamp: RateStamp | null } {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Remove timestamps older than the rate limit window
    while (requestTimestamps.length > 0 && requestTimestamps[0].at < windowStart) {
      requestTimestamps.shift();
    }

    // Check if we've exceeded the limit
    if (requestTimestamps.length >= RATE_LIMIT) {
      return { allowed: false, remaining: 0, stamp: null };
    }

    // Add current timestamp and return remaining quota
    const stamp = { at: now };
    requestTimestamps.push(stamp);
    return { allowed: true, remaining: RATE_LIMIT - requestTimestamps.length, stamp };
  }

  function refundRate(stamp: RateStamp | null): void {
    if (!stamp) return;
    const index = requestTimestamps.indexOf(stamp);
    if (index !== -1) requestTimestamps.splice(index, 1);
  }

  function payloadTokens(payload: { messages?: Array<{ content?: unknown }> } | undefined): number {
    const text = (payload?.messages ?? [])
      .map((message) => (typeof message?.content === 'string' ? message.content : ''))
      .join('\n');
    return estimateTokens(text);
  }

  function respond(
    sendResponse: (response: unknown) => void,
    body: { success: boolean; data?: unknown; error?: string; cancelled?: boolean }
  ): void {
    try {
      sendResponse(body);
    } catch (error) {
      console.error('[Background] Failed to send check response:', error);
    }
  }

  // Auto-inject API keys from environment on startup (dev mode only)
  if (import.meta.env.DEV) {
    const devKeys: Record<string, string> = {};
    const openRouterKey =
      import.meta.env.OPENROUTER_API_KEY || import.meta.env.VITE_OPENROUTER_API_KEY;
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (openRouterKey) devKeys.openRouterKey = openRouterKey;
    if (groqKey) devKeys.groqKey = groqKey;

    // Auto-select provider based on which env key is available
    if (groqKey && !openRouterKey) {
      devKeys.selectedProvider = 'groq';
    } else if (openRouterKey && !groqKey) {
      devKeys.selectedProvider = 'openrouter';
    }

    if (Object.keys(devKeys).length > 0) {
      browser.storage.local
        .set(devKeys)
        .then(() => {
          console.log('API keys injected from environment (dev mode):', Object.keys(devKeys));
        })
        .catch((error) => {
          console.error('Failed to inject API keys:', error);
        });
    }
  }

  // Listen for messages from content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Validate message origin - must be from our extension
    if (!sender.id || sender.id !== browser.runtime.id) {
      sendResponse({ success: false, error: 'Unauthorized message sender' });
      return false;
    }

    if (message.action === 'injectFrameStyles') {
      const file = typeof message.file === 'string' ? message.file : '';
      if (!isFrameStyleFile(file)) {
        sendResponse({ success: false, error: 'Unknown stylesheet' });
        return false;
      }
      const tabId = sender.tab?.id;
      const frameId = sender.frameId;
      if (tabId == null || typeof frameId !== 'number') {
        sendResponse({ success: false, error: 'Missing frame' });
        return false;
      }
      void browser.scripting
        .insertCSS({
          target: { tabId, frameIds: [frameId] },
          files: [file],
        })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : 'Could not insert CSS';
          console.error('[SafeTyper] Failed to insert frame styles:', error);
          sendResponse({ success: false, error: detail });
        });
      return true;
    }

    if (message.action === 'openPopup') {
      // Since we can't directly open the popup, we'll open a new tab with the popup page
      browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
    } else if (message.action === 'fetchModels') {
      const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

      (async () => {
        try {
          // Resolve provider
          const storedProvider = (await browser.storage.local.get(['selectedProvider']))
            .selectedProvider;
          const provider: ApiProvider =
            (typeof message.provider === 'string' &&
              message.provider in PROVIDER_CONFIG &&
              (message.provider as ApiProvider)) ||
            (typeof storedProvider === 'string' &&
              storedProvider in PROVIDER_CONFIG &&
              (storedProvider as ApiProvider)) ||
            DEFAULT_PROVIDER;
          const providerConfig = PROVIDER_CONFIG[provider];

          // Check cache first (unless force refresh)
          if (!message.force) {
            const stored = await browser.storage.local.get([providerConfig.cachedModelsStorageKey]);
            const cached = stored[providerConfig.cachedModelsStorageKey] as
              { models?: unknown; fetchedAt?: number } | undefined;
            if (
              cached &&
              typeof cached.fetchedAt === 'number' &&
              Date.now() - cached.fetchedAt < CACHE_TTL
            ) {
              sendResponse({ success: true, data: cached.models });
              return;
            }
          }

          // Resolve models endpoint (dynamic for Ollama)
          let modelsUrl: string = providerConfig.modelsEndpoint;
          let ollamaBaseUrl = '';
          if (provider === 'ollama') {
            const endpointStored = await browser.storage.local.get(['ollamaEndpoint']);
            ollamaBaseUrl =
              (typeof endpointStored.ollamaEndpoint === 'string' &&
                endpointStored.ollamaEndpoint) ||
              DEFAULT_OLLAMA_ENDPOINT;
            modelsUrl = `${ollamaBaseUrl}/api/tags`;
          }

          let fetchOptions: RequestInit = {};
          if (provider === 'ollama') {
            fetchOptions = { headers: { Origin: ollamaBaseUrl } };
          } else if (provider === 'groq') {
            // Groq's models endpoint requires authentication
            const { groqKey } = await browser.storage.local.get(['groqKey']);
            fetchOptions = { headers: { Authorization: `Bearer ${groqKey}` } };
          }
          const response = await fetch(modelsUrl, {
            ...fetchOptions,
            signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
          }

          const json = await response.json();
          let models;

          if (provider === 'openrouter') {
            models = json.data
              .filter((m: any) => {
                const modality = m.architecture?.modality || '';
                const isText = modality.includes('text');
                const isAvailable = m.pricing?.prompt !== '-1';
                return isText && isAvailable;
              })
              .map((m: any) => ({
                id: m.id,
                name: m.name || m.id,
                pricing: {
                  prompt: m.pricing?.prompt || '0',
                  completion: m.pricing?.completion || '0',
                },
              }))
              .sort((a: any, b: any) => a.name.localeCompare(b.name));
          } else if (provider === 'groq') {
            // Groq models endpoint returns {data: [{id, object, created, owned_by, active}]}
            // Skip speech and moderation models, they do not support chat completions
            models = json.data
              .filter(
                (m: any) =>
                  m.object === 'model' &&
                  m.active !== false &&
                  !/whisper|tts|orpheus|guard/i.test(m.id)
              )
              .map((m: any) => ({
                id: m.id,
                name: m.id,
                pricing: { prompt: '0', completion: '0' },
              }))
              .sort((a: any, b: any) => a.name.localeCompare(b.name));
          } else {
            // Ollama models endpoint returns {models: [{name, model, size, ...}]}
            models = (json.models || [])
              .map((m: any) => ({
                id: m.name || m.model,
                name: m.name || m.model,
                pricing: { prompt: '0', completion: '0' },
              }))
              .sort((a: any, b: any) => a.name.localeCompare(b.name));
          }

          // Cache in storage
          await browser.storage.local.set({
            [providerConfig.cachedModelsStorageKey]: { models, fetchedAt: Date.now() },
          });

          sendResponse({ success: true, data: models });
        } catch (error: any) {
          console.error('[Background] Failed to fetch models:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();

      return true; // async response
    } else if (message.action === 'cancelGrammarCheck') {
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      inflightChecks.get(requestId)?.controller.abort();
      sendResponse({ success: true });
      return false;
    } else if (message.action === 'checkGrammar' || message.action === 'translate') {
      // Translate uses the same provider and key as grammar checks, without JSON mode.
      const tokens = payloadTokens(message.payload);
      const decision = consumeTokenBudget(tokenLog, Date.now(), tokens);
      tokenLog = decision.entries;
      if (!decision.allowed) {
        sendResponse({
          success: false,
          error: 'Token budget exceeded. Please wait a moment before trying again.',
        });
        return false;
      }
      const spend = tokens > 0 ? (tokenLog[tokenLog.length - 1] ?? null) : null;

      const rateLimitStatus = checkRateLimit();
      if (!rateLimitStatus.allowed) {
        if (spend) tokenLog = refundTokenSpend(tokenLog, spend);
        sendResponse({
          success: false,
          error: 'Rate limit exceeded. Please wait a moment before trying again.',
        });
        return false;
      }

      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const scope = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}`;
      const feature = featureForRequest(message.action, requestId);
      // A manual check replaces check-as-you-type so both cannot generate at once.
      if (feature === 'card') flights.abort(scope, 'auto-check');
      const controller = flights.start(scope, feature);
      if (requestId) {
        inflightChecks.set(requestId, {
          controller,
          rateStamp: rateLimitStatus.stamp,
          spend,
        });
      }

      const releaseCancelled = (): void => {
        if (!requestId) return;
        const tracked = inflightChecks.get(requestId);
        if (!tracked) return;
        inflightChecks.delete(requestId);
        refundRate(tracked.rateStamp);
        if (tracked.spend) tokenLog = refundTokenSpend(tokenLog, tracked.spend);
      };

      let settled = false;
      const finish = (
        body: { success: boolean; data?: unknown; error?: string; cancelled?: boolean },
        refund: boolean
      ): void => {
        if (settled) return;
        settled = true;
        flights.finish(scope, feature, controller);
        if (refund) releaseCancelled();
        else if (requestId) inflightChecks.delete(requestId);
        releaseWorker();
        respond(sendResponse, body);
      };

      holdWorker();
      const wantsJson = message.action === 'checkGrammar';

      void (async () => {
        let provider: ApiProvider = DEFAULT_PROVIDER;
        try {
          const result = await browser.storage.local.get([
            'selectedProvider',
            'openRouterKey',
            'groqKey',
            'ollamaEndpoint',
          ]);
          provider =
            (typeof result.selectedProvider === 'string' &&
              result.selectedProvider in PROVIDER_CONFIG &&
              (result.selectedProvider as ApiProvider)) ||
            DEFAULT_PROVIDER;
          const providerConfig = PROVIDER_CONFIG[provider];
          const headers: Record<string, string> = {};
          let endpoint: string = providerConfig.chatEndpoint;

          if (providerConfig.requiresApiKey) {
            const apiKey = result[providerConfig.keyStorageKey];
            if (!apiKey) {
              finish({ success: false, error: 'API key not configured' }, true);
              return;
            }
            if (typeof apiKey !== 'string' || !providerConfig.keyRegex.test(apiKey)) {
              finish(
                { success: false, error: `Invalid ${providerConfig.name} API key format` },
                true
              );
              return;
            }
            headers.Authorization = `Bearer ${apiKey}`;
            if (providerConfig.requiresReferer) {
              headers['HTTP-Referer'] = message.referer;
            }
          } else {
            endpoint =
              (typeof result.ollamaEndpoint === 'string' && result.ollamaEndpoint) ||
              DEFAULT_OLLAMA_ENDPOINT;
            headers.Origin = endpoint;
          }

          if (controller.signal.aborted) {
            finish({ success: false, error: 'Request cancelled', cancelled: true }, true);
            return;
          }

          const payload = message.payload ?? {};
          const messages = Array.isArray(payload.messages) ? payload.messages : [];
          const content = await runProviderChat({
            provider,
            endpoint,
            headers,
            model: typeof payload.model === 'string' ? payload.model : providerConfig.defaultModel,
            messages,
            temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.2,
            json: wantsJson && provider === 'ollama',
            kind: message.action === 'translate' ? 'translate' : 'check',
            openAiBody: payload,
            signal: controller.signal,
          });
          finish({ success: true, data: { choices: [{ message: { content } }] } }, false);
        } catch (error: unknown) {
          if (isRequestTimeout(error)) {
            finish({ success: false, error: timeoutMessage(provider) }, true);
            return;
          }
          if (isAbortError(error) || controller.signal.aborted) {
            finish({ success: false, error: 'Request cancelled', cancelled: true }, true);
            return;
          }
          const detail = error instanceof Error ? error.message : 'Request failed';
          finish({ success: false, error: detail }, false);
        }
      })();

      return true;
    } else if (message.action === 'checkOllamaConnection') {
      (async () => {
        try {
          const stored = await browser.storage.local.get(['ollamaEndpoint']);
          const baseUrl =
            (typeof stored.ollamaEndpoint === 'string' && stored.ollamaEndpoint) ||
            DEFAULT_OLLAMA_ENDPOINT;
          const response = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            headers: { Origin: baseUrl },
            signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const json = await response.json();
          const modelCount = json.models?.length || 0;
          sendResponse({ success: true, modelCount });
        } catch (error: any) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
  });
});
