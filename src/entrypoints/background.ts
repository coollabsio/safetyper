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
      const existingScript = scripts.find(s => s.id === scriptId);

      if (!existingScript) {
        console.log('[Background] Registering content script...');
        await browser.scripting.registerContentScripts([{
          id: scriptId,
          matches: ['<all_urls>'],
          css: ['content-scripts/content.css'],
          js: ['content-scripts/content.js'],
          runAt: 'document_idle',
          allFrames: false
        }]);
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
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
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
  browser.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Extension installed/updated');
    await registerContentScripts();
    await reloadAllTabs();
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

  // Auto-inject API key from environment on startup (dev mode only)
  const apiKey = import.meta.env.DEV ? (import.meta.env.OPENROUTER_API_KEY || import.meta.env.VITE_OPENROUTER_API_KEY) : null;
  if (apiKey) {
    browser.storage.local.set({
      openRouterKey: apiKey
    }).then(() => {
      console.log('API key injected from environment (dev mode)');
    }).catch((error) => {
      console.error('Failed to inject API key:', error);
    });
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
    } else if (message.action === 'checkGrammar') {
      // Check rate limit
      const rateLimitStatus = checkRateLimit();
      if (!rateLimitStatus.allowed) {
        sendResponse({
          success: false,
          error: 'Rate limit exceeded. Please wait a moment before trying again.'
        });
        return false;
      }

      // Handle grammar check request - retrieve API key securely from storage
      browser.storage.local.get(['openRouterKey']).then(result => {
        const apiKey = result.openRouterKey;

        if (!apiKey) {
          sendResponse({ success: false, error: 'API key not configured' });
          return;
        }

        // Validate API key format (OpenRouter keys start with sk-or-v1-)
        if (!apiKey.match(/^sk-or-v1-[a-f0-9]{64}$/)) {
          sendResponse({ success: false, error: 'Invalid API key format' });
          return;
        }

        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': message.referer,
          },
          body: JSON.stringify(message.payload)
        })
          .then(response => {
            if (!response.ok) {
              throw new Error(`API request failed with status ${response.status}`);
            }
            return response.json();
          })
          .then(data => sendResponse({ success: true, data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      }).catch(error => {
        sendResponse({ success: false, error: 'Failed to retrieve API key' });
      });

      // Return true to indicate we'll respond asynchronously
      return true;
    }
  });
});
