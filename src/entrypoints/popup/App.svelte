<script lang="ts">
  import { onMount } from "svelte";
  import { storage } from "#imports";

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

   // Load settings on mount
   onMount(async () => {
     try {
       selectedModel = await selectedModelStorage.getValue();
       openRouterKey = (await openRouterKeyStorage.getValue()) || "";

       // Auto-set API key from environment if not already set
       if (!openRouterKey && import.meta.env.VITE_OPENROUTER_API_KEY) {
         openRouterKey = import.meta.env.VITE_OPENROUTER_API_KEY;
         await openRouterKeyStorage.setValue(openRouterKey);
       }
     } catch (error) {
       console.error("Error loading settings:", error);
     }
   });

  // Save settings
  async function saveSettings() {
    isLoading = true;
    try {
      await selectedModelStorage.setValue(selectedModel);
      await openRouterKeyStorage.setValue(openRouterKey);
      // Show success message
      showSavedPopup = true;
      setTimeout(() => {
        showSavedPopup = false;
      }, 2000);
    } catch (error) {
      console.error("Error saving settings:", error);
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
          stroke="#4A90E2"
          stroke-width="2"
          fill="white"
        />
        <path
          d="M7 10C7 10 9.5 7 12 7C14.5 7 17 10 17 10"
          stroke="#4A90E2"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M12 12V17"
          stroke="#4A90E2"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="12" cy="17" r="1" fill="#4A90E2" />
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
    font-family: "Inter", sans-serif;
  }

  header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    text-align: center;
    width: 100%;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  .tagline {
    margin: 8px 0 0;
    opacity: 0.9;
    font-size: 14px;
  }

  .content {
    padding: 20px;
    width: 100%;
    box-sizing: border-box;
  }

  .content.full-width {
    padding: 20px;
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
    font-size: 14px;
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
  }

  .model-select,
  .api-key-input {
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    background: white;
    color: #333;
    width: 100%;
    box-sizing: border-box;
  }

  .model-select {
    cursor: pointer;
  }

  .model-select:focus,
  .api-key-input:focus {
    outline: none;
    border-color: #4a90e2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
  }

  .save-button {
    background: #4a90e2;
    color: white;
    border: none;
    padding: 12px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    transition: background 0.2s ease;
    width: 100%;
    box-sizing: border-box;
  }

  .save-button:hover:not(:disabled) {
    background: #357abd;
  }

  .save-button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .help-text {
    font-size: 12px;
    color: #666;
    margin: 4px 0 0;
  }

  .help-text a {
    color: #4a90e2;
    text-decoration: none;
  }

  .help-text a:hover {
    text-decoration: underline;
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
  }

  .saved-popup-content {
    background: #4caf50;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
</style>
