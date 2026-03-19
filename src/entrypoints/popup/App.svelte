<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import type { OpenRouterModel } from '../../lib/content/types';

  const selectedModelStorage = storage.defineItem<string>('local:selectedModel', {
    fallback: 'google/gemini-2.5-flash',
  });

  const openRouterKeyStorage = storage.defineItem<string>('local:openRouterKey');

  // Fallback models when API is unreachable
  const FALLBACK_MODELS: OpenRouterModel[] = [
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

  // State
  let selectedModel = 'google/gemini-2.5-flash';
  let openRouterKey = '';
  let isLoading = false;
  let showSavedPopup = false;
  let isApiKeyFromEnv = false;

  // Model combobox state
  let allModels: OpenRouterModel[] = FALLBACK_MODELS;
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
        force,
      });
      if (response?.success && response.data?.length > 0) {
        allModels = response.data;
        // Auto-reset if selected model no longer exists
        if (!allModels.find((m) => m.id === selectedModel)) {
          selectedModel = 'google/gemini-2.5-flash';
        }
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      // Keep fallback models
    } finally {
      isLoadingModels = false;
    }
  }

  // Validate API key format
  function validateApiKey(key: string): { valid: boolean; error?: string } {
    if (!key || key.trim() === '') {
      return { valid: false, error: 'API key is required' };
    }
    const apiKeyRegex = /^sk-or-v1-[a-f0-9]{64}$/;
    if (!apiKeyRegex.test(key.trim())) {
      return {
        valid: false,
        error: 'Invalid API key format. OpenRouter keys should start with sk-or-v1-',
      };
    }
    return { valid: true };
  }

  async function saveSettings() {
    isLoading = true;
    try {
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
    openRouterKey = (event.target as HTMLInputElement).value;
  }

  function openTestPage() {
    const testUrl = browser.runtime.getURL('/test.html');
    browser.tabs.create({ url: testUrl });
  }

  onMount(async () => {
    try {
      selectedModel = await selectedModelStorage.getValue();
      openRouterKey = (await openRouterKeyStorage.getValue()) || '';

      if (!openRouterKey && import.meta.env.DEV && import.meta.env.VITE_OPENROUTER_API_KEY) {
        openRouterKey = import.meta.env.VITE_OPENROUTER_API_KEY;
        await openRouterKeyStorage.setValue(openRouterKey);
        isApiKeyFromEnv = true;
      } else if (
        openRouterKey &&
        import.meta.env.DEV &&
        import.meta.env.VITE_OPENROUTER_API_KEY === openRouterKey
      ) {
        isApiKeyFromEnv = true;
      }
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
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" stroke="#6b16ed" stroke-width="2" fill="none" />
        <path
          d="M7 10C7 10 9.5 7 12 7C14.5 7 17 10 17 10"
          stroke="#6b16ed"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path d="M12 12V17" stroke="#6b16ed" stroke-width="2" stroke-linecap="round" />
        <circle cx="12" cy="17" r="1" fill="#6b16ed" />
      </svg>
      <h1>SafeTyper</h1>
    </div>
    <p class="tagline">Grammar Check Assistant</p>
  </header>

  <div class="content">
    <div class="settings">
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
                  <span class="model-price">{formatPrice(model)}</span>
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
        <label for="api-key-input" class="setting-label">OpenRouter API Key</label>
        <input
          id="api-key-input"
          type="password"
          class="api-key-input"
          placeholder="Enter your OpenRouter API key"
          value={openRouterKey}
          oninput={handleApiKeyChange}
        />
        <p class="help-text">
          Get your API key from <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a>
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
    background: #fff;
    color: #000;
    padding: 16px 20px 14px;
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
    border-radius: 0.125rem;
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
    border-radius: 0.125rem;
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
    border-radius: 0 0 0.25rem 0.25rem;
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

  .api-key-input {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: #fff;
    color: #000;
    border: 0;
    border-radius: 0.125rem;
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
    border-radius: 0.125rem;
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
    border-radius: 0.125rem;
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
