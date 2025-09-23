export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

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
