<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import type { ApiProvider, OpenRouterModel } from '../../lib/content/types';
  import {
    PROVIDER_CONFIG,
    DEFAULT_PROVIDER,
    DEFAULT_SYSTEM_PROMPT,
  } from '../../lib/content/config';

  const version = browser.runtime.getManifest().version;

  const selectedProviderStorage = storage.defineItem<ApiProvider>('local:selectedProvider', {
    fallback: 'openrouter',
  });

  const selectedModelStorage = storage.defineItem<string>('local:selectedModel', {
    fallback: 'google/gemini-2.5-flash',
  });

  const openRouterKeyStorage = storage.defineItem<string>('local:openRouterKey');

  const groqSelectedModelStorage = storage.defineItem<string>('local:groqSelectedModel', {
    fallback: 'openai/gpt-oss-120b',
  });

  const groqKeyStorage = storage.defineItem<string>('local:groqKey');

  const ollamaSelectedModelStorage = storage.defineItem<string>('local:ollamaSelectedModel', {
    fallback: 'llama3.2',
  });

  const ollamaEndpointStorage = storage.defineItem<string>('local:ollamaEndpoint', {
    fallback: 'http://localhost:11434',
  });

  const darkModeStorage = storage.defineItem<boolean>('local:darkMode', {
    fallback: false,
  });

  const customSystemPromptStorage = storage.defineItem<string>('local:customSystemPrompt', {
    fallback: '',
  });

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
      id: 'openai/gpt-oss-120b',
      name: 'openai/gpt-oss-120b',
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'openai/gpt-oss-20b',
      name: 'openai/gpt-oss-20b',
      pricing: { prompt: '0', completion: '0' },
    },
  ];

  const OLLAMA_FALLBACK_MODELS: OpenRouterModel[] = [
    { id: 'llama3.2', name: 'llama3.2', pricing: { prompt: '0', completion: '0' } },
  ];

  function getFallbackModels(provider: ApiProvider): OpenRouterModel[] {
    if (provider === 'openrouter') return OPENROUTER_FALLBACK_MODELS;
    if (provider === 'groq') return GROQ_FALLBACK_MODELS;
    return OLLAMA_FALLBACK_MODELS;
  }

  // State
  let selectedProvider = $state<ApiProvider>('openrouter');
  let selectedModel = $state('google/gemini-2.5-flash');
  let apiKey = $state('');
  let isLoading = $state(false);
  let showSavedPopup = $state(false);
  let isApiKeyFromEnv = $state(false);
  let darkMode = $state(false);
  let ollamaEndpoint = $state('http://localhost:11434');
  let connectionStatus: 'idle' | 'checking' | 'connected' | 'error' = $state('idle');
  let connectionError = $state('');
  let connectionModelCount = $state(0);
  let customSystemPrompt = $state('');
  let showAdvanced = $state(false);

  let providerConfig = $derived(PROVIDER_CONFIG[selectedProvider]);
  let showPricing = $derived(selectedProvider === 'openrouter');
  let isOllama = $derived(selectedProvider === 'ollama');

  // Model combobox state
  let allModels: OpenRouterModel[] = $state(OPENROUTER_FALLBACK_MODELS);
  let isLoadingModels = $state(false);
  let searchQuery = $state('');
  let isDropdownOpen = $state(false);
  let highlightedIndex = $state(-1);
  let comboboxEl: HTMLDivElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();

  let filteredModels = $derived(
    allModels.filter((m) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    })
  );

  let selectedModelDisplay = $derived(
    allModels.find((m) => m.id === selectedModel)?.name || selectedModel
  );

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

  function validateApiKey(key: string): { valid: boolean; error?: string } {
    if (isOllama) return { valid: true };
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
      if (!isOllama && apiKey && apiKey.trim() !== '') {
        const validation = validateApiKey(apiKey);
        if (!validation.valid) {
          alert(validation.error);
          isLoading = false;
          return;
        }
      }

      await selectedProviderStorage.setValue(selectedProvider);

      if (selectedProvider === 'ollama') {
        await ollamaSelectedModelStorage.setValue(selectedModel);
        await ollamaEndpointStorage.setValue(ollamaEndpoint);
      } else if (selectedProvider === 'openrouter') {
        await selectedModelStorage.setValue(selectedModel);
        await openRouterKeyStorage.setValue(apiKey.trim());
      } else {
        await groqSelectedModelStorage.setValue(selectedModel);
        await groqKeyStorage.setValue(apiKey.trim());
      }

      await customSystemPromptStorage.setValue(customSystemPrompt);

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

    try {
      if (newProvider === 'ollama') {
        selectedModel = (await ollamaSelectedModelStorage.getValue()) || config.defaultModel;
        ollamaEndpoint = (await ollamaEndpointStorage.getValue()) || 'http://localhost:11434';
        apiKey = '';
        connectionStatus = 'idle';
      } else if (newProvider === 'openrouter') {
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

    isApiKeyFromEnv = false;
    if (import.meta.env.DEV && newProvider !== 'ollama') {
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

    allModels = getFallbackModels(newProvider);
    await fetchModels();
  }

  function applyTheme(isDark: boolean) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  async function toggleDarkMode() {
    darkMode = !darkMode;
    await darkModeStorage.setValue(darkMode);
    applyTheme(darkMode);
  }

  async function checkOllamaConnection() {
    connectionStatus = 'checking';
    connectionError = '';
    try {
      await ollamaEndpointStorage.setValue(ollamaEndpoint);
      const response = await browser.runtime.sendMessage({ action: 'checkOllamaConnection' });
      if (response?.success) {
        connectionStatus = 'connected';
        connectionModelCount = response.modelCount;
        await fetchModels(true);
      } else {
        connectionStatus = 'error';
        connectionError = response?.error || 'Connection failed';
      }
    } catch (error: any) {
      connectionStatus = 'error';
      connectionError = error.message || 'Connection failed';
    }
  }

  function handleEndpointChange(event: Event) {
    ollamaEndpoint = (event.target as HTMLInputElement).value;
    connectionStatus = 'idle';
  }

  function resetSystemPrompt() {
    customSystemPrompt = '';
  }

  function openTestPage() {
    const testUrl = browser.runtime.getURL('/test.html');
    browser.tabs.create({ url: testUrl });
  }

  onMount(async () => {
    darkMode = (await darkModeStorage.getValue()) ?? false;
    applyTheme(darkMode);

    try {
      selectedProvider = (await selectedProviderStorage.getValue()) || DEFAULT_PROVIDER;
      const config = PROVIDER_CONFIG[selectedProvider];

      if (selectedProvider === 'ollama') {
        selectedModel = (await ollamaSelectedModelStorage.getValue()) || config.defaultModel;
        ollamaEndpoint = (await ollamaEndpointStorage.getValue()) || 'http://localhost:11434';
        apiKey = '';
      } else if (selectedProvider === 'openrouter') {
        selectedModel = (await selectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await openRouterKeyStorage.getValue()) || '';
      } else {
        selectedModel = (await groqSelectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await groqKeyStorage.getValue()) || '';
      }

      if (import.meta.env.DEV && selectedProvider !== 'ollama') {
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
      customSystemPrompt = (await customSystemPromptStorage.getValue()) || '';
    } catch (error) {
      console.error('Error loading settings:', error);
    }

    await fetchModels();

    document.addEventListener('click', handleClickOutside);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
  });
</script>

<main>
  <div class="header-row">
    <div class="header-brand">
      <img src="/icon/32.png" alt="SafeTyper" class="header-logo" />
      <span class="header-title">SafeTyper</span>
    </div>
    <div class="header-controls">
      <a
        href="https://safetyper.com/sponsorships"
        target="_blank"
        class="sponsor-link"
        aria-label="Sponsor SafeTyper"
      >
        <span>Donate</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            stroke="#ff2d8a"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </a>
      <a
        href={`https://github.com/coollabsio/safetyper/releases/tag/v${version}`}
        target="_blank"
        class="version">v{version}</a
      >
      <button
        class="theme-toggle"
        onclick={toggleDarkMode}
        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if darkMode}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </button>
    </div>
  </div>
  <div class="content">
    <div class="form">
      <div class="field">
        <label for="provider-select">API Provider</label>
        <select
          id="provider-select"
          class="select"
          value={selectedProvider}
          onchange={handleProviderChange}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
          <option value="ollama">Ollama</option>
        </select>
      </div>

      <div class="field">
        <div class="label-row">
          <label for="model-search">LLM Model</label>
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
                d="M3 5L6 2L9 5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M3 7L6 10L9 7"
                stroke="currentColor"
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

      {#if isOllama}
        <div class="field">
          <label for="endpoint-input">Ollama Endpoint</label>
          <input
            id="endpoint-input"
            type="text"
            class="input"
            placeholder="http://localhost:11434"
            value={ollamaEndpoint}
            oninput={handleEndpointChange}
          />
          <div class="connection-row">
            <button
              class="secondary-btn small"
              onclick={checkOllamaConnection}
              disabled={connectionStatus === 'checking'}
            >
              {connectionStatus === 'checking' ? 'Checking...' : 'Check Connection'}
            </button>
            {#if connectionStatus === 'connected'}
              <span class="status-text connected">
                Connected ({connectionModelCount}
                {connectionModelCount === 1 ? 'model' : 'models'})
              </span>
            {:else if connectionStatus === 'error'}
              <span class="status-text error">{connectionError}</span>
            {/if}
          </div>
          <p class="help-text">Enter the URL of your Ollama instance (local or remote)</p>
        </div>
      {:else}
        <div class="field">
          <label for="api-key-input">{providerConfig.name} API Key</label>
          <input
            id="api-key-input"
            type="password"
            class="input"
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
      {/if}

      <div class="field">
        <button class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
          {showAdvanced ? '▾' : '▸'} Advanced Settings
        </button>
      </div>

      {#if showAdvanced}
        <div class="field">
          <div class="label-row">
            <label for="system-prompt">System Prompt</label>
            <button class="refresh-btn" onclick={resetSystemPrompt}>Reset to Default</button>
          </div>
          <textarea
            id="system-prompt"
            class="input textarea"
            placeholder={DEFAULT_SYSTEM_PROMPT}
            bind:value={customSystemPrompt}
            rows="4"
          ></textarea>
          <p class="help-text">
            Customize the instruction sent to the LLM. Leave empty to use the default prompt.
          </p>
        </div>
      {/if}

      <div class="field">
        <button class="primary-btn" onclick={saveSettings} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Settings'}
        </button>
        {#if showSavedPopup}
          <div class="save-feedback" role="status" aria-live="polite">Settings saved.</div>
        {/if}
      </div>

      {#if import.meta.env.DEV}
        <div class="field dev-section">
          <div class="dev-badge">Development Mode</div>
          <button class="secondary-btn" onclick={openTestPage}>Open Test Page</button>
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  :global(html),
  :global(body) {
    background: var(--st-bg);
  }

  main {
    width: 100%;
    padding: 0;
    position: relative;
    font-family:
      'Geist Sans',
      Inter,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: var(--st-bg);
    color: var(--st-text);
  }

  .content {
    padding: 20px;
    width: 100%;
    box-sizing: border-box;
    background: var(--st-bg);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .field label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--st-text);
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .textarea {
    min-height: 8rem;
    resize: vertical;
    line-height: 1.4;
  }

  /* Theme toggle */
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    font-family: inherit;
    color: var(--st-text-secondary);
    background: none;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .theme-toggle:hover {
    color: var(--st-text);
  }

  .advanced-toggle {
    background: none;
    border: none;
    color: var(--st-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 4px 0;
    text-align: left;
  }

  .advanced-toggle:hover {
    color: var(--st-text);
  }

  .model-name {
    font-weight: 500;
  }

  .model-price {
    font-size: 0.6875rem;
    color: var(--st-text-secondary);
  }

  /* Scrollbar for dropdown */
  .combobox-list::-webkit-scrollbar {
    width: 4px;
  }
  .combobox-list::-webkit-scrollbar-track {
    background: var(--st-bg-secondary);
  }
  .combobox-list::-webkit-scrollbar-thumb {
    background: var(--st-text-muted);
    border-radius: 2px;
  }

  .connection-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }

  /* Inline form feedback */
  .save-feedback {
    margin-top: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--st-success-border);
    border-radius: 0.375rem;
    background: var(--st-success-surface);
    color: var(--st-success-text);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  /* Header */
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--st-border);
    background: var(--st-bg-elevated);
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-logo {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .header-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--st-text);
    letter-spacing: -0.01em;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sponsor-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #ff2d8a;
    font-size: 0.6875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .version {
    font-size: 0.6875rem;
    color: var(--st-text-secondary);
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .version:hover {
    color: var(--st-text);
  }

  /* Dev section */
  .dev-section {
    border-top: 1px solid var(--st-border);
    padding-top: 16px;
    margin-top: 4px;
  }

  .dev-badge {
    background: var(--st-brand-surface);
    color: var(--st-brand-text);
    border: 1px solid var(--st-brand);
    padding: 3px 8px;
    border-radius: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-block;
    margin-bottom: 8px;
  }

  .env-indicator {
    background: var(--st-warning-surface);
    color: var(--st-warning-text);
    border: 1px solid var(--st-warning-border);
    padding: 8px 12px;
    border-radius: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 500;
    margin-top: 4px;
  }
</style>
