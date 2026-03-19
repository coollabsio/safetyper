<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import type { ApiProvider, OpenRouterModel } from '../../lib/content/types';
  import { PROVIDER_CONFIG, DEFAULT_PROVIDER } from '../../lib/content/config';

  const selectedProviderStorage = storage.defineItem<ApiProvider>('local:selectedProvider', {
    fallback: 'openrouter',
  });

  const selectedModelStorage = storage.defineItem<string>('local:selectedModel', {
    fallback: 'google/gemini-2.5-flash',
  });

  const openRouterKeyStorage = storage.defineItem<string>('local:openRouterKey');

  const groqSelectedModelStorage = storage.defineItem<string>('local:groqSelectedModel', {
    fallback: 'llama-3.3-70b-versatile',
  });

  const groqKeyStorage = storage.defineItem<string>('local:groqKey');

  // Fallback models per provider
  const OPENROUTER_FALLBACK_MODELS: OpenRouterModel[] = [
    {
      id: 'google/gemini-2.5-flash',
      name: 'Google: Gemini 2.5 Flash',
      pricing: { prompt: '0.000000075', completion: '0.0000003' },
    },
    {
      id: 'google/gemini-2.0-flash-001',
      name: 'Google: Gemini 2.0 Flash',
      pricing: { prompt: '0.000000075', completion: '0.0000003' },
    },
    {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o Mini',
      pricing: { prompt: '0.00000015', completion: '0.0000006' },
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct',
      name: 'Meta: Llama 3.3 70B',
      pricing: { prompt: '0.00000059', completion: '0.00000079' },
    },
    {
      id: 'anthropic/claude-3-5-sonnet',
      name: 'Anthropic: Claude 3.5 Sonnet',
      pricing: { prompt: '0.000003', completion: '0.000015' },
    },
  ];

  const GROQ_FALLBACK_MODELS: OpenRouterModel[] = [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'llama-3.3-70b-versatile',
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'llama-3.1-8b-instant',
      name: 'llama-3.1-8b-instant',
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'gemma2-9b-it',
      name: 'gemma2-9b-it',
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'mixtral-8x7b-32768',
      pricing: { prompt: '0', completion: '0' },
    },
  ];

  function getFallbackModels(provider: ApiProvider): OpenRouterModel[] {
    return provider === 'openrouter' ? OPENROUTER_FALLBACK_MODELS : GROQ_FALLBACK_MODELS;
  }

  // State
  let selectedProvider: ApiProvider = 'openrouter';
  let selectedModel = 'google/gemini-2.5-flash';
  let apiKey = '';
  let isLoading = false;
  let showSavedPopup = false;
  let isApiKeyFromEnv = false;

  $: providerConfig = PROVIDER_CONFIG[selectedProvider];
  $: showPricing = selectedProvider === 'openrouter';

  // Model combobox state
  let allModels: OpenRouterModel[] = OPENROUTER_FALLBACK_MODELS;
  let isLoadingModels = false;
  let searchQuery = '';
  let isDropdownOpen = false;
  let highlightedIndex = -1;
  let comboboxEl: HTMLDivElement;
  let listEl: HTMLUListElement;
  let inputEl: HTMLInputElement;

  $: filteredModels = allModels.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  $: selectedModelDisplay = allModels.find((m) => m.id === selectedModel)?.name || selectedModel;

  function formatPrice(model: OpenRouterModel): string {
    const promptPrice = parseFloat(model.pricing.prompt) * 1_000_000;
    const completionPrice = parseFloat(model.pricing.completion) * 1_000_000;
    const fmt = (n: number) => {
      if (n === 0) return '$0';
      if (n < 0.01) return `$${n.toFixed(4)}`;
      if (n < 1) return `$${n.toFixed(2)}`;
      return `$${n.toFixed(1)}`;
    };
    return `${fmt(promptPrice)} / ${fmt(completionPrice)} per M tokens`;
  }

  function openDropdown() {
    isDropdownOpen = true;
    searchQuery = '';
    highlightedIndex = -1;
  }

  function closeDropdown() {
    isDropdownOpen = false;
    searchQuery = '';
    highlightedIndex = -1;
  }

  function toggleDropdown() {
    if (isDropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
      // Focus the input after opening
      setTimeout(() => inputEl?.focus(), 0);
    }
  }

  function selectModel(model: OpenRouterModel) {
    selectedModel = model.id;
    closeDropdown();
  }

  function handleSearchInput(event: Event) {
    searchQuery = (event.target as HTMLInputElement).value;
    highlightedIndex = -1;
    if (!isDropdownOpen) isDropdownOpen = true;
  }

  function handleComboKeydown(event: KeyboardEvent) {
    if (!isDropdownOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, filteredModels.length - 1);
        scrollToHighlighted();
        break;
      case 'ArrowUp':
        event.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        scrollToHighlighted();
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredModels.length) {
          selectModel(filteredModels[highlightedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        closeDropdown();
        break;
    }
  }

  function scrollToHighlighted() {
    if (!listEl || highlightedIndex < 0) return;
    const items = listEl.querySelectorAll('li');
    if (items[highlightedIndex]) {
      items[highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (comboboxEl && !comboboxEl.contains(event.target as Node)) {
      closeDropdown();
    }
  }

  async function fetchModels(force = false) {
    isLoadingModels = true;
    try {
      const response = await browser.runtime.sendMessage({
        action: 'fetchModels',
        provider: selectedProvider,
        force,
      });
      if (response?.success && response.data?.length > 0) {
        allModels = response.data;
        // Auto-reset if selected model no longer exists
        if (!allModels.find((m) => m.id === selectedModel)) {
          selectedModel = providerConfig.defaultModel;
        }
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      allModels = getFallbackModels(selectedProvider);
    } finally {
      isLoadingModels = false;
    }
  }

  // Validate API key format
  function validateApiKey(key: string): { valid: boolean; error?: string } {
    if (!key || key.trim() === '') {
      return { valid: false, error: 'API key is required' };
    }
    if (!providerConfig.keyRegex.test(key.trim())) {
      return {
        valid: false,
        error: `Invalid API key format. ${providerConfig.name} keys should start with ${providerConfig.keyPrefix}`,
      };
    }
    return { valid: true };
  }

  async function saveSettings() {
    isLoading = true;
    try {
      if (apiKey && apiKey.trim() !== '') {
        const validation = validateApiKey(apiKey);
        if (!validation.valid) {
          alert(validation.error);
          isLoading = false;
          return;
        }
      }

      await selectedProviderStorage.setValue(selectedProvider);

      if (selectedProvider === 'openrouter') {
        await selectedModelStorage.setValue(selectedModel);
        await openRouterKeyStorage.setValue(apiKey.trim());
      } else {
        await groqSelectedModelStorage.setValue(selectedModel);
        await groqKeyStorage.setValue(apiKey.trim());
      }

      showSavedPopup = true;
      setTimeout(() => {
        showSavedPopup = false;
      }, 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      isLoading = false;
    }
  }

  function handleApiKeyChange(event: Event) {
    apiKey = (event.target as HTMLInputElement).value;
  }

  async function handleProviderChange(event: Event) {
    const newProvider = (event.target as HTMLSelectElement).value as ApiProvider;
    selectedProvider = newProvider;
    const config = PROVIDER_CONFIG[newProvider];

    // Load the new provider's settings from storage
    try {
      if (newProvider === 'openrouter') {
        selectedModel = (await selectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await openRouterKeyStorage.getValue()) || '';
      } else {
        selectedModel = (await groqSelectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await groqKeyStorage.getValue()) || '';
      }
    } catch {
      selectedModel = config.defaultModel;
      apiKey = '';
    }

    // Check if key came from env
    isApiKeyFromEnv = false;
    if (import.meta.env.DEV) {
      if (
        newProvider === 'openrouter' &&
        apiKey &&
        apiKey === import.meta.env.VITE_OPENROUTER_API_KEY
      ) {
        isApiKeyFromEnv = true;
      } else if (newProvider === 'groq' && apiKey && apiKey === import.meta.env.VITE_GROQ_API_KEY) {
        isApiKeyFromEnv = true;
      }
    }

    // Load models for the new provider
    allModels = getFallbackModels(newProvider);
    await fetchModels();
  }

  function openTestPage() {
    const testUrl = browser.runtime.getURL('/test.html');
    browser.tabs.create({ url: testUrl });
  }

  onMount(async () => {
    try {
      selectedProvider = (await selectedProviderStorage.getValue()) || DEFAULT_PROVIDER;
      const config = PROVIDER_CONFIG[selectedProvider];

      if (selectedProvider === 'openrouter') {
        selectedModel = (await selectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await openRouterKeyStorage.getValue()) || '';
      } else {
        selectedModel = (await groqSelectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await groqKeyStorage.getValue()) || '';
      }

      // Check for dev env auto-injection
      if (import.meta.env.DEV) {
        const envKey =
          selectedProvider === 'openrouter'
            ? import.meta.env.VITE_OPENROUTER_API_KEY
            : import.meta.env.VITE_GROQ_API_KEY;
        if (!apiKey && envKey) {
          apiKey = envKey;
          if (selectedProvider === 'openrouter') {
            await openRouterKeyStorage.setValue(apiKey);
          } else {
            await groqKeyStorage.setValue(apiKey);
          }
          isApiKeyFromEnv = true;
        } else if (apiKey && envKey && apiKey === envKey) {
          isApiKeyFromEnv = true;
        }
      }

      allModels = getFallbackModels(selectedProvider);
    } catch (error) {
      console.error('Error loading settings:', error);
    }

    // Fetch models from API
    await fetchModels();

    // Click-outside listener
    document.addEventListener('click', handleClickOutside);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
  });
</script>

<main>
  <header>
    <div class="logo-container">
      <img
        src="/icon/48.png"
        width="24"
        height="24"
        alt="Safetyper"
        style="image-rendering: pixelated;"
      />
      <h1>Safetyper</h1>
    </div>
    <p class="tagline">Grammar Check Assistant</p>
  </header>

  <div class="content">
    <div class="settings">
      <div class="setting-group">
        <label for="provider-select" class="setting-label">API Provider</label>
        <select
          id="provider-select"
          class="provider-select"
          value={selectedProvider}
          onchange={handleProviderChange}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
        </select>
      </div>

      <div class="setting-group">
        <div class="label-row">
          <label for="model-search" class="setting-label">LLM Model</label>
          <button class="refresh-btn" onclick={() => fetchModels(true)} disabled={isLoadingModels}>
            {isLoadingModels ? '...' : 'Refresh'}
          </button>
        </div>

        <!-- svelte-ignore a11y_role_has_required_aria_props -->
        <div class="combobox" bind:this={comboboxEl} role="combobox">
          <input
            id="model-search"
            type="text"
            class="combobox-input"
            placeholder="Search models..."
            value={isDropdownOpen ? searchQuery : selectedModelDisplay}
            onfocus={openDropdown}
            oninput={handleSearchInput}
            onkeydown={handleComboKeydown}
            bind:this={inputEl}
          />
          <button
            class="combobox-toggle"
            onclick={toggleDropdown}
            tabindex="-1"
            aria-label="Toggle model list"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="#737373"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          {#if isDropdownOpen}
            <ul class="combobox-list" bind:this={listEl}>
              {#each filteredModels as model, i (model.id)}
                <li
                  class:highlighted={i === highlightedIndex}
                  class:selected={model.id === selectedModel}
                  onclick={() => selectModel(model)}
                  onkeydown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectModel(model);
                    }
                  }}
                  role="option"
                  aria-selected={model.id === selectedModel}
                >
                  <span class="model-name">{model.name}</span>
                  {#if showPricing}
                    <span class="model-price">{formatPrice(model)}</span>
                  {/if}
                </li>
              {/each}
              {#if filteredModels.length === 0}
                <li class="no-results">No models found</li>
              {/if}
            </ul>
          {/if}
        </div>
      </div>

      <div class="setting-group">
        <label for="api-key-input" class="setting-label">{providerConfig.name} API Key</label>
        <input
          id="api-key-input"
          type="password"
          class="api-key-input"
          placeholder="Enter your {providerConfig.name} API key"
          value={apiKey}
          oninput={handleApiKeyChange}
        />
        <p class="help-text">
          Get your API key from <a href={providerConfig.keysUrl} target="_blank"
            >{providerConfig.name}</a
          >
        </p>
        {#if isApiKeyFromEnv && import.meta.env.DEV}
          <div class="env-indicator">API key auto-loaded from .env file</div>
        {/if}
      </div>

      <div class="setting-group">
        <button class="save-button" onclick={saveSettings} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {#if import.meta.env.DEV}
        <div class="setting-group dev-section">
          <div class="dev-badge">Development Mode</div>
          <button class="test-button" onclick={openTestPage}> Open Test Page </button>
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
        <span>Settings saved!</span>
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    width: 100%;
    min-height: 400px;
    padding: 0;
    font-family:
      Inter,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: #f9fafb;
  }

  header {
    background: #f9fafb;
    color: #000;
    padding: 16px 20px 14px;
    text-align: center;
    width: 100%;
    border-bottom: none;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: #000;
  }

  .tagline {
    margin: 2px 0 0;
    color: #737373;
    font-size: 0.8125rem;
    font-weight: 400;
  }

  .content {
    padding: 16px 20px;
    width: 100%;
    box-sizing: border-box;
    background: #f9fafb;
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .setting-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #000;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .refresh-btn {
    background: none;
    border: none;
    color: #6b16ed;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 0.25rem;
    transition: background-color 0.15s ease;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #f5f0ff;
  }

  .refresh-btn:disabled {
    color: #d4d4d4;
    cursor: not-allowed;
  }

  /* Combobox */
  .combobox {
    position: relative;
    width: 100%;
  }

  .combobox-input {
    display: block;
    padding: 0.375rem 2rem 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: #fff;
    color: #000;
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px #e5e5e5;
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
    text-overflow: ellipsis;
  }

  .combobox-input:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 #6b16ed,
      inset 0 0 0 2px #e5e5e5;
  }

  .combobox-input::placeholder {
    color: #d4d4d4;
  }

  .combobox-toggle {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: 2rem;
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .combobox-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: #fff;
    border: 2px solid #e5e5e5;
    border-top: 1px solid #e5e5e5;
    border-radius: 0 0 0.5rem 0.5rem;
    z-index: 100;
    list-style: none;
    padding: 0;
    margin: 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .combobox-list li {
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-left: 3px solid transparent;
  }

  .combobox-list li:hover,
  .combobox-list li.highlighted {
    background: #f5f0ff;
  }

  .combobox-list li.selected {
    border-left-color: #6b16ed;
    background: #faf8ff;
  }

  .combobox-list li.no-results {
    color: #737373;
    font-size: 0.8125rem;
    cursor: default;
    padding: 10px 8px;
  }

  .model-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .model-price {
    font-size: 0.6875rem;
    color: #737373;
  }

  /* Scrollbar for dropdown */
  .combobox-list::-webkit-scrollbar {
    width: 4px;
  }
  .combobox-list::-webkit-scrollbar-track {
    background: #f5f5f5;
  }
  .combobox-list::-webkit-scrollbar-thumb {
    background: #d4d4d4;
    border-radius: 2px;
  }

  .provider-select {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: #fff;
    color: #000;
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px #e5e5e5;
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23737373' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    padding-right: 2rem;
  }

  .provider-select:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 #6b16ed,
      inset 0 0 0 2px #e5e5e5;
  }

  .api-key-input {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: #fff;
    color: #000;
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px #e5e5e5;
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
  }

  .api-key-input:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 #6b16ed,
      inset 0 0 0 2px #e5e5e5;
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
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: inherit;
    text-transform: none;
    color: #5a12c7;
    background: #f5f0ff;
    border: 2px solid #6b16ed;
    border-radius: 0.25rem;
    outline: 0;
    cursor: pointer;
    min-width: fit-content;
    width: 100%;
    box-sizing: border-box;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .save-button:hover:not(:disabled) {
    background: #6b16ed;
    color: #fff;
  }

  .save-button:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px #6b16ed;
  }

  .save-button:disabled {
    cursor: not-allowed;
    border-color: transparent;
    background: transparent;
    color: #d4d4d4;
  }

  .help-text {
    font-size: 0.6875rem;
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
    padding: 14px 20px;
    border: 1px solid #e5e5e5;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    box-shadow: 0 5px 15px -3px rgba(0, 0, 0, 0.08);
    font-size: 0.8125rem;
  }

  .saved-popup-content svg path {
    stroke: #22c55e;
  }

  .dev-section {
    border-top: 1px solid #e5e5e5;
    padding-top: 16px;
    margin-top: 4px;
  }

  .dev-badge {
    background: #f5f0ff;
    color: #5a12c7;
    border: 1px solid #6b16ed;
    padding: 3px 8px;
    border-radius: 0.125rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-block;
    margin-bottom: 8px;
  }

  .test-button {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
    padding: 0 0.5rem;
    height: 2rem;
    font-size: 0.8125rem;
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
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 4px #6b16ed;
  }

  .env-indicator {
    background: #fefce8;
    color: #854d0e;
    border: 1px solid #fde047;
    padding: 8px 12px;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 500;
    margin-top: 4px;
  }
</style>
