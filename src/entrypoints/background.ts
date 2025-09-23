export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  console.log('Available env vars:', Object.keys(import.meta.env));
  console.log('OPENROUTER_API_KEY:', import.meta.env.OPENROUTER_API_KEY);
  console.log('VITE_OPENROUTER_API_KEY:', import.meta.env.VITE_OPENROUTER_API_KEY);

  // Auto-inject API key from environment on startup
  const apiKey = import.meta.env.OPENROUTER_API_KEY || import.meta.env.VITE_OPENROUTER_API_KEY;
  if (apiKey) {
    console.log('OpenRouter API key found:', apiKey.substring(0, 20) + '...');
    browser.storage.local.set({
      openRouterKey: apiKey
    }).then(() => {
      console.log('OpenRouter API key injected from environment');
    }).catch((error) => {
      console.error('Failed to inject OpenRouter API key:', error);
    });
  }

  // Listen for messages from content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openPopup') {
      // Since we can't directly open the popup, we'll open a new tab with the popup page
      browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
    } else if (message.action === 'checkGrammar') {
      // Handle grammar check request
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${message.apiKey}`,
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
        .catch(error => sendResponse({ success: false, error: error.message }))

      // Return true to indicate we'll respond asynchronously
      return true;
    }
  });
});
