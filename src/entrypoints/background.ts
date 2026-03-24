import type { ApiProvider } from '@/lib/content/types';
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_PROVIDER, PROVIDER_CONFIG } from '@/lib/content/config';

export default defineBackground(() => {
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
      const existingScript = scripts.find((s) => s.id === scriptId);

      if (!existingScript) {
        console.log('[Background] Registering content script...');
        await browser.scripting.registerContentScripts([
          {
            id: scriptId,
            matches: ['<all_urls>'],
            css: ['content-scripts/content.css'],
            js: ['content-scripts/content.js'],
            runAt: 'document_idle',
            allFrames: false,
          },
        ]);
        console.log('[Background] ✅ Content script registered successfully');
      } else {
        console.log('[Background] Content script already registered, skipping');
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
  const requestTimestamps: number[] = [];

  function checkRateLimit(): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Remove timestamps older than the rate limit window
    while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
      requestTimestamps.shift();
    }

    // Check if we've exceeded the limit
    if (requestTimestamps.length >= RATE_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    // Add current timestamp and return remaining quota
    requestTimestamps.push(now);
    return { allowed: true, remaining: RATE_LIMIT - requestTimestamps.length };
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

    if (message.action === 'openPopup') {
      // Since we can't directly open the popup, we'll open a new tab with the popup page
      browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
    } else if (message.action === 'fetchModels') {
      const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

      (async () => {
        try {
          // Resolve provider
          const provider: ApiProvider =
            message.provider ||
            (await browser.storage.local.get(['selectedProvider'])).selectedProvider ||
            DEFAULT_PROVIDER;
          const providerConfig = PROVIDER_CONFIG[provider];

          // Check cache first (unless force refresh)
          if (!message.force) {
            const stored = await browser.storage.local.get([providerConfig.cachedModelsStorageKey]);
            const cached = stored[providerConfig.cachedModelsStorageKey];
            if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
              sendResponse({ success: true, data: cached.models });
              return;
            }
          }

          // Resolve models endpoint (dynamic for Ollama)
          let modelsUrl: string = providerConfig.modelsEndpoint;
          let ollamaBaseUrl = '';
          if (provider === 'ollama') {
            const endpointStored = await browser.storage.local.get(['ollamaEndpoint']);
            ollamaBaseUrl = endpointStored.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT;
            modelsUrl = `${ollamaBaseUrl}/api/tags`;
          }

          const fetchOptions: RequestInit =
            provider === 'ollama' ? { headers: { Origin: ollamaBaseUrl } } : {};
          const response = await fetch(modelsUrl, fetchOptions);
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
            // Groq models endpoint returns {data: [{id, object, created, owned_by}]}
            models = json.data
              .filter((m: any) => m.object === 'model' && m.active !== false)
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
    } else if (message.action === 'checkGrammar') {
      // Check rate limit
      const rateLimitStatus = checkRateLimit();
      if (!rateLimitStatus.allowed) {
        sendResponse({
          success: false,
          error: 'Rate limit exceeded. Please wait a moment before trying again.',
        });
        return false;
      }

      // Handle grammar check request - retrieve API key securely from storage
      browser.storage.local
        .get(['selectedProvider', 'openRouterKey', 'groqKey', 'ollamaEndpoint'])
        .then((result) => {
          const provider: ApiProvider = result.selectedProvider || DEFAULT_PROVIDER;
          const providerConfig = PROVIDER_CONFIG[provider];

          if (providerConfig.requiresApiKey) {
            const apiKey = result[providerConfig.keyStorageKey];

            if (!apiKey) {
              sendResponse({ success: false, error: 'API key not configured' });
              return;
            }

            // Validate API key format
            if (!providerConfig.keyRegex.test(apiKey)) {
              sendResponse({
                success: false,
                error: `Invalid ${providerConfig.name} API key format`,
              });
              return;
            }

            const headers: Record<string, string> = {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            };
            if (providerConfig.requiresReferer) {
              headers['HTTP-Referer'] = message.referer;
            }

            fetch(providerConfig.chatEndpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(message.payload),
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`API request failed with status ${response.status}`);
                }
                return response.json();
              })
              .then((data) => sendResponse({ success: true, data }))
              .catch((error) => sendResponse({ success: false, error: error.message }));
          } else {
            // Ollama: no API key, dynamic endpoint, set Origin to bypass CORS check
            const baseUrl = result.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT;
            const chatUrl = `${baseUrl}/v1/chat/completions`;

            fetch(chatUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: baseUrl,
              },
              body: JSON.stringify(message.payload),
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`API request failed with status ${response.status}`);
                }
                return response.json();
              })
              .then((data) => sendResponse({ success: true, data }))
              .catch((error) => sendResponse({ success: false, error: error.message }));
          }
        })
        .catch((error) => {
          sendResponse({ success: false, error: 'Failed to retrieve API configuration' });
        });

      // Return true to indicate we'll respond asynchronously
      return true;
    } else if (message.action === 'checkOllamaConnection') {
      (async () => {
        try {
          const stored = await browser.storage.local.get(['ollamaEndpoint']);
          const baseUrl = stored.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT;
          const response = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            headers: { Origin: baseUrl },
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
