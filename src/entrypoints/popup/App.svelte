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
          stroke="#6b16ed"
          stroke-width="2"
          fill="none"
        />
        <path
          d="M7 10C7 10 9.5 7 12 7C14.5 7 17 10 17 10"
          stroke="#6b16ed"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M12 12V17"
          stroke="#6b16ed"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="12" cy="17" r="1" fill="#6b16ed" />
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
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    background: #f9fafb;
  }

  header {
    background: #fff;
    color: #000;
    padding: 24px 24px 20px;
    text-align: center;
    width: 100%;
    border-bottom: 1px solid #e5e5e5;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: #000;
  }

  .tagline {
    margin: 4px 0 0;
    color: #737373;
    font-size: 0.875rem;
    font-weight: 400;
  }

  .content {
    padding: 24px;
    width: 100%;
    box-sizing: border-box;
    background: #f9fafb;
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
    font-size: 0.875rem;
    font-weight: 500;
    color: #000;
  }

  .model-select,
  .api-key-input {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.875rem;
    font-family: inherit;
    background: #fff;
    color: #000;
    border: 0;
    border-radius: 0.125rem;
    box-shadow: inset 4px 0 0 transparent, inset 0 0 0 2px #e5e5e5;
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
  }

  .model-select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%23000000'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9'/%3e%3c/svg%3e");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1rem 1rem;
    padding-right: 2.5rem;
  }

  .model-select:focus,
  .api-key-input:focus {
    outline: none;
    box-shadow: inset 4px 0 0 #6b16ed, inset 0 0 0 2px #e5e5e5;
  }

  .api-key-input::placeholder {
    color: #d4d4d4;
  }

  .save-button {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
    padding: 0 0.5rem;
    height: 2rem;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    text-transform: none;
    color: #5a12c7;
    background: #f5f0ff;
    border: 2px solid #6b16ed;
    border-radius: 0.125rem;
    outline: 0;
    cursor: pointer;
    min-width: fit-content;
    width: 100%;
    box-sizing: border-box;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .save-button:hover:not(:disabled) {
    background: #6b16ed;
    color: #fff;
  }

  .save-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #6b16ed;
  }

  .save-button:disabled {
    cursor: not-allowed;
    border-color: transparent;
    background: transparent;
    color: #d4d4d4;
  }

  .help-text {
    font-size: 0.75rem;
    color: #737373;
    margin: 2px 0 0;
    font-weight: 400;
  }

  .help-text a {
    color: #6b16ed;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
    transition: color 0.15s ease;
  }

  .help-text a:hover {
    color: #000;
  }

  .saved-popup {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .saved-popup-content {
    background: #fff;
    color: #000;
    padding: 16px 24px;
    border: 1px solid #e5e5e5;
    border-radius: 0.125rem;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    box-shadow: 0 5px 15px -3px rgba(0, 0, 0, 0.08);
    font-size: 0.875rem;
  }

  .saved-popup-content svg path {
    stroke: #22C55E;
  }

  /* Development mode section */
  .dev-section {
    border-top: 1px solid #e5e5e5;
    padding-top: 20px;
    margin-top: 8px;
  }

  .dev-badge {
    background: #f5f0ff;
    color: #5a12c7;
    border: 1px solid #6b16ed;
    padding: 4px 10px;
    border-radius: 0.125rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-block;
    margin-bottom: 12px;
  }

  .test-button {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
    padding: 0 0.5rem;
    height: 2rem;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    text-transform: none;
    background: #fff;
    color: #000;
    border: 2px solid #e5e5e5;
    border-radius: 0.125rem;
    outline: 0;
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    transition: background-color 0.15s ease;
  }

  .test-button:hover {
    background: #f5f5f5;
    color: #000;
  }

  .test-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #6b16ed;
  }

  /* Environment variable indicator */
  .env-indicator {
    background: #fefce8;
    color: #854d0e;
    border: 1px solid #fde047;
    padding: 10px 14px;
    border-radius: 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
