<script lang="ts">
  import { onMount } from "svelte";
  import { storage } from "#imports";
  import { browser } from "wxt/browser";

  // Define storage items for better type safety and easier management
  const selectedModelStorage = storage.defineItem<string>(
    "local:selectedModel",
    {
      fallback: "google/gemini-2.5-flash",
    },
  );

  const openRouterKeyStorage = storage.defineItem<string>(
    "local:openRouterKey",
  );
  const llmModels = [
    {
      id: "google/gemini-2.5-flash",
      name: "Gemini 2.5 Flash (~$0.075/$0.30 per M tokens)",
    },
    {
      id: "google/gemini-2.0-flash-001",
      name: "Gemini 2.0 Flash (~$0.075/$0.30 per M tokens)",
    },
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini (~$0.15/$0.60 per M tokens)",
    },
    {
      id: "openai/gpt-4.1-mini-2025-04-14",
      name: "GPT-4.1 Mini (~$0.15/$0.60 per M tokens)",
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct",
      name: "Llama 3.3 70B (~$0.59/$0.79 per M tokens)",
    },
    {
      id: "meta-llama/llama-3.1-70b-instruct",
      name: "Llama 3.1 70B (~$0.59/$0.79 per M tokens)",
    },
    { id: "google/gemini-pro", name: "Gemini Pro (~$0.50/$1.50 per M tokens)" },
    {
      id: "anthropic/claude-4-sonnet-20250522",
      name: "Claude 4 Sonnet (~$3/$15 per M tokens)",
    },
    {
      id: "anthropic/claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet (~$3/$15 per M tokens)",
    },
    {
      id: "openai/gpt-5-2025-08-07",
      name: "GPT-5 (Preview) (~$3/$15 per M tokens)",
    },
    {
      id: "google/gemini-2.5-pro",
      name: "Gemini 2.5 Pro (~$1.25/$5 per M tokens)",
    },
    { id: "x-ai/grok-4-fast", name: "Grok 4 Fast (~$5/$15 per M tokens)" },
  ];

  // State variables
  let selectedModel = "google/gemini-2.5-flash";
  let openRouterKey = "";
  let isLoading = false;
  let showSavedPopup = false;
  let isApiKeyFromEnv = false;

   // Load settings on mount
   onMount(async () => {
     try {
       selectedModel = await selectedModelStorage.getValue();
       openRouterKey = (await openRouterKeyStorage.getValue()) || "";

        // Auto-set API key from environment if not already set (dev mode only)
        if (!openRouterKey && import.meta.env.DEV && import.meta.env.VITE_OPENROUTER_API_KEY) {
          openRouterKey = import.meta.env.VITE_OPENROUTER_API_KEY;
          await openRouterKeyStorage.setValue(openRouterKey);
          isApiKeyFromEnv = true;
       } else if (openRouterKey && import.meta.env.DEV && import.meta.env.VITE_OPENROUTER_API_KEY === openRouterKey) {
          // Check if the stored key matches the env key
          isApiKeyFromEnv = true;
       }
     } catch (error) {
       console.error("Error loading settings:", error);
     }
   });

  // Validate API key format
  function validateApiKey(key: string): { valid: boolean; error?: string } {
    if (!key || key.trim() === '') {
      return { valid: false, error: 'API key is required' };
    }

    // OpenRouter API keys should start with sk-or-v1- followed by 64 hex characters
    const apiKeyRegex = /^sk-or-v1-[a-f0-9]{64}$/;
    if (!apiKeyRegex.test(key.trim())) {
      return { valid: false, error: 'Invalid API key format. OpenRouter keys should start with sk-or-v1-' };
    }

    return { valid: true };
  }

  // Save settings
  async function saveSettings() {
    isLoading = true;
    try {
      // Validate API key if provided
      if (openRouterKey && openRouterKey.trim() !== '') {
        const validation = validateApiKey(openRouterKey);
        if (!validation.valid) {
          alert(validation.error);
          isLoading = false;
          return;
        }
      }

      await selectedModelStorage.setValue(selectedModel);
      await openRouterKeyStorage.setValue(openRouterKey.trim());
      // Show success message
      showSavedPopup = true;
      setTimeout(() => {
        showSavedPopup = false;
      }, 2000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings. Please try again.");
    } finally {
      isLoading = false;
    }
  }

  // Handle model change
  function handleModelChange(event: Event) {
    selectedModel = (event.target as HTMLSelectElement).value;
  }

  // Handle API key change
  function handleApiKeyChange(event: Event) {
    openRouterKey = (event.target as HTMLInputElement).value;
  }

  // Open test page
  function openTestPage() {
    const testUrl = browser.runtime.getURL('/test.html');
    browser.tabs.create({ url: testUrl });
  }
</script>

<main>
  <header>
    <div class="logo-container">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="#292929"
          stroke-width="2"
          fill="none"
        />
        <path
          d="M7 10C7 10 9.5 7 12 7C14.5 7 17 10 17 10"
          stroke="#292929"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M12 12V17"
          stroke="#292929"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="12" cy="17" r="1" fill="#292929" />
      </svg>
      <h1>SafeTyper</h1>
    </div>
    <p class="tagline">Grammar Check Assistant</p>
  </header>

  <div class="content full-width">
    <div class="settings">
      <div class="setting-group">
        <label for="model-select" class="setting-label">LLM Model</label>
        <select
          id="model-select"
          class="model-select"
          value={selectedModel}
          on:change={handleModelChange}
        >
          {#each llmModels as model}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>
      </div>

      <div class="setting-group">
        <label for="api-key-input" class="setting-label"
          >OpenRouter API Key</label
        >
        <input
          id="api-key-input"
          type="password"
          class="api-key-input"
          placeholder="Enter your OpenRouter API key"
          value={openRouterKey}
          on:input={handleApiKeyChange}
        />
        <p class="help-text">
          Get your API key from <a
            href="https://openrouter.ai/keys"
            target="_blank">OpenRouter</a
          >
        </p>
        {#if isApiKeyFromEnv && import.meta.env.DEV}
          <div class="env-indicator">
            ✅ API key auto-loaded from .env file
          </div>
        {/if}
      </div>

      <div class="setting-group">
        <button
          class="save-button"
          on:click={saveSettings}
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {#if import.meta.env.DEV}
        <div class="setting-group dev-section">
          <div class="dev-badge">Development Mode</div>
          <button
            class="test-button"
            on:click={openTestPage}
          >
            🧪 Open Test Page
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if showSavedPopup}
    <div class="saved-popup">
      <div class="saved-popup-content">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M20 6L9 17L4 12"
            stroke="white"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>Settings saved successfully!</span>
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 400px;
    padding: 0;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    background: #FAFAFA;
  }

  header {
    background: #FFFFFF;
    color: #000000;
    padding: 24px 24px 20px;
    text-align: center;
    width: 100%;
    border-bottom: 1px solid #F0F0F0;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.4px;
    color: #000000;
  }

  .tagline {
    margin: 4px 0 0;
    color: #666666;
    font-size: 13px;
    font-weight: 400;
  }

  .content {
    padding: 24px;
    width: 100%;
    box-sizing: border-box;
    background: #FAFAFA;
  }

  .content.full-width {
    padding: 24px;
    width: 100%;
    box-sizing: border-box;
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 500;
    color: #292929;
    margin-bottom: 4px;
    letter-spacing: -0.1px;
  }

  .model-select,
  .api-key-input {
    padding: 11px 14px;
    border: 1px solid #E0E0E0;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    background: #FFFFFF;
    color: #000000;
    width: 100%;
    box-sizing: border-box;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .model-select {
    cursor: pointer;
  }

  .model-select:hover,
  .api-key-input:hover {
    border-color: #C0C0C0;
  }

  .model-select:focus,
  .api-key-input:focus {
    outline: none;
    border-color: #000000;
    box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);
  }

  .save-button {
    background: #292929;
    color: #FFFFFF;
    border: none;
    padding: 12px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.15s ease;
    width: 100%;
    box-sizing: border-box;
    letter-spacing: -0.1px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .save-button:hover:not(:disabled) {
    background: #1a1a1a;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }

  .save-button:active:not(:disabled) {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .save-button:disabled {
    background: #E5E5E5;
    color: #A0A0A0;
    cursor: not-allowed;
    box-shadow: none;
  }

  .help-text {
    font-size: 12px;
    color: #666666;
    margin: 2px 0 0;
    font-weight: 400;
  }

  .help-text a {
    color: #000000;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
    transition: opacity 0.15s ease;
  }

  .help-text a:hover {
    opacity: 0.6;
  }

  .saved-popup {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .saved-popup-content {
    background: #292929;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    font-size: 14px;
  }

  /* Development mode section */
  .dev-section {
    border-top: 1px solid #E8E8E8;
    padding-top: 20px;
    margin-top: 8px;
  }

  .dev-badge {
    background: #292929;
    color: white;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-block;
    margin-bottom: 12px;
  }

  .test-button {
    background: #FFFFFF;
    color: #292929;
    border: 1px solid #E0E0E0;
    padding: 12px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.15s ease;
    width: 100%;
    box-sizing: border-box;
    letter-spacing: -0.1px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .test-button:hover {
    background: #292929;
    color: #FFFFFF;
    border-color: #292929;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }

  .test-button:active {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  /* Environment variable indicator */
  .env-indicator {
    background: #F5F5F5;
    color: #292929;
    border: 1px solid #E8E8E8;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
