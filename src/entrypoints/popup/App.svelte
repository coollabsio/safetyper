<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import type { ApiProvider, OpenRouterModel } from '../../lib/content/types';
  import { PROVIDER_CONFIG, DEFAULT_PROVIDER } from '../../lib/content/config';

  const version = browser.runtime.getManifest().version;

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

  const ollamaSelectedModelStorage = storage.defineItem<string>('local:ollamaSelectedModel', {
    fallback: 'llama3.2',
  });

  const ollamaEndpointStorage = storage.defineItem<string>('local:ollamaEndpoint', {
    fallback: 'http://localhost:11434',
  });

  const darkModeStorage = storage.defineItem<boolean>('local:darkMode', {
    fallback: false,
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

  const OLLAMA_FALLBACK_MODELS: OpenRouterModel[] = [
    { id: 'llama3.2', name: 'llama3.2', pricing: { prompt: '0', completion: '0' } },
  ];

  function getFallbackModels(provider: ApiProvider): OpenRouterModel[] {
    if (provider === 'openrouter') return OPENROUTER_FALLBACK_MODELS;
    if (provider === 'groq') return GROQ_FALLBACK_MODELS;
    return OLLAMA_FALLBACK_MODELS;
  }

  // State
  let selectedProvider: ApiProvider = 'openrouter';
  let selectedModel = 'google/gemini-2.5-flash';
  let apiKey = '';
  let isLoading = false;
  let showSavedPopup = false;
  let isApiKeyFromEnv = false;
  let darkMode = false;
  let ollamaEndpoint = 'http://localhost:11434';
  let connectionStatus: 'idle' | 'checking' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let connectionModelCount = 0;

  $: providerConfig = PROVIDER_CONFIG[selectedProvider];
  $: showPricing = selectedProvider === 'openrouter';
  $: isOllama = selectedProvider === 'ollama';

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

    // Check if key came from env
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

    // Load models for the new provider
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

  function openTestPage() {
    const testUrl = browser.runtime.getURL('/test.html');
    browser.tabs.create({ url: testUrl });
  }

  onMount(async () => {
    // Load dark mode first to avoid flash
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

      // Check for dev env auto-injection
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
    <div class="settings">
      <h2 class="section-title">Settings</h2>
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
          <option value="ollama">Ollama</option>
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

      {#if isOllama}
        <div class="setting-group">
          <label for="endpoint-input" class="setting-label">Ollama Endpoint</label>
          <input
            id="endpoint-input"
            type="text"
            class="api-key-input"
            placeholder="http://localhost:11434"
            value={ollamaEndpoint}
            oninput={handleEndpointChange}
          />
          <div class="connection-row">
            <button
              class="check-connection-btn"
              onclick={checkOllamaConnection}
              disabled={connectionStatus === 'checking'}
            >
              {connectionStatus === 'checking' ? 'Checking...' : 'Check Connection'}
            </button>
            {#if connectionStatus === 'connected'}
              <span class="connection-status connected">
                Connected ({connectionModelCount}
                {connectionModelCount === 1 ? 'model' : 'models'})
              </span>
            {:else if connectionStatus === 'error'}
              <span class="connection-status error">
                {connectionError}
              </span>
            {/if}
          </div>
          <p class="help-text">Enter the URL of your Ollama instance (local or remote)</p>
        </div>
      {:else}
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
      {/if}

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
  :global(:root) {
    --st-bg: #ffffff;
    --st-bg-secondary: #f5f5f5;
    --st-bg-elevated: #ffffff;
    --st-text: #000000;
    --st-text-secondary: #737373;
    --st-text-muted: #d4d4d4;
    --st-border: #e5e5e5;
    --st-brand: #6b16ed;
    --st-brand-dark: #5a12c7;
    --st-brand-surface: #f5f0ff;
    --st-brand-surface-alt: #faf8ff;
    --st-brand-text: #5a12c7;
    --st-success: #22c55e;
    --st-warning-surface: #fefce8;
    --st-warning-border: #fde047;
    --st-warning-text: #854d0e;
    --st-shadow: rgba(0, 0, 0, 0.08);
    --st-overlay: rgba(0, 0, 0, 0.3);
    --st-focus-ring: #6b16ed;
    --st-btn-bg: #6b16ed;
    --st-btn-hover-bg: #5a12c7;
    --st-btn-border: #6b16ed;
    --st-select-arrow: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23737373' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }

  :global(:root[data-theme='dark']) {
    --st-bg: #1a1a1a;
    --st-bg-secondary: #262626;
    --st-bg-elevated: #2a2a2a;
    --st-text: #e5e5e5;
    --st-text-secondary: #a3a3a3;
    --st-text-muted: #525252;
    --st-border: #404040;
    --st-brand: #8b5cf6;
    --st-brand-dark: #7c3aed;
    --st-brand-surface: #2d1b69;
    --st-brand-surface-alt: #231554;
    --st-brand-text: #c4b5fd;
    --st-success: #4ade80;
    --st-warning-surface: #422006;
    --st-warning-border: #854d0e;
    --st-warning-text: #fde047;
    --st-shadow: rgba(0, 0, 0, 0.3);
    --st-overlay: rgba(0, 0, 0, 0.5);
    --st-focus-ring: #8b5cf6;
    --st-btn-bg: #2d1b69;
    --st-btn-hover-bg: #8b5cf6;
    --st-btn-border: #8b5cf6;
    --st-select-arrow: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23a3a3a3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }

  :global(html),
  :global(body) {
    background: var(--st-bg);
  }

  main {
    width: 100%;
    padding: 0;
    position: relative;
    font-family:
      Inter,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: var(--st-bg);
  }

  .content {
    padding: 16px 20px 8px;
    width: 100%;
    box-sizing: border-box;
    background: var(--st-bg);
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
    color: var(--st-text);
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

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

  .refresh-btn {
    background: none;
    border: none;
    color: var(--st-brand);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 0.25rem;
    transition: background-color 0.15s ease;
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--st-brand-surface);
  }

  .refresh-btn:disabled {
    color: var(--st-text-muted);
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
    background: var(--st-bg);
    color: var(--st-text);
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px var(--st-border);
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
    text-overflow: ellipsis;
  }

  .combobox-input:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 var(--st-brand),
      inset 0 0 0 2px var(--st-border);
  }

  .combobox-input::placeholder {
    color: var(--st-text-muted);
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
    color: var(--st-text-secondary);
  }

  .combobox-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: var(--st-bg);
    border: 2px solid var(--st-border);
    border-top: 1px solid var(--st-border);
    border-radius: 0 0 0.5rem 0.5rem;
    z-index: 100;
    list-style: none;
    padding: 0;
    margin: 0;
    box-shadow: 0 4px 12px var(--st-shadow);
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
    background: var(--st-brand-surface);
  }

  .combobox-list li.selected {
    border-left-color: var(--st-brand);
    background: var(--st-brand-surface-alt);
  }

  .combobox-list li.no-results {
    color: var(--st-text-secondary);
    font-size: 0.8125rem;
    cursor: default;
    padding: 10px 8px;
  }

  .model-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--st-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .provider-select {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: var(--st-bg);
    color: var(--st-text);
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px var(--st-border);
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
    cursor: pointer;
    appearance: none;
    background-image: var(--st-select-arrow);
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    padding-right: 2rem;
  }

  .provider-select:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 var(--st-brand),
      inset 0 0 0 2px var(--st-border);
  }

  .provider-select option {
    background: var(--st-bg);
    color: var(--st-text);
  }

  .api-key-input {
    display: block;
    padding: 0.375rem 0.5rem;
    width: 100%;
    font-size: 0.8125rem;
    font-family: inherit;
    background: var(--st-bg);
    color: var(--st-text);
    border: 0;
    border-radius: 0.25rem;
    box-shadow:
      inset 4px 0 0 transparent,
      inset 0 0 0 2px var(--st-border);
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
  }

  .api-key-input:focus {
    outline: none;
    box-shadow:
      inset 4px 0 0 var(--st-brand),
      inset 0 0 0 2px var(--st-border);
  }

  .api-key-input::placeholder {
    color: var(--st-text-muted);
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
    color: #fff;
    background: var(--st-btn-bg);
    border: 2px solid var(--st-btn-border);
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
    background: var(--st-btn-hover-bg);
    color: #fff;
  }

  .save-button:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--st-bg),
      0 0 0 4px var(--st-focus-ring);
  }

  .save-button:disabled {
    cursor: not-allowed;
    border-color: transparent;
    background: transparent;
    color: var(--st-text-muted);
  }

  .help-text {
    font-size: 0.6875rem;
    color: var(--st-text-secondary);
    margin: 2px 0 0;
    font-weight: 400;
  }

  .help-text a {
    color: var(--st-brand);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
    transition: color 0.15s ease;
  }

  .help-text a:hover {
    color: var(--st-text);
  }

  .saved-popup {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--st-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .saved-popup-content {
    background: var(--st-bg-elevated);
    color: var(--st-text);
    padding: 14px 20px;
    border: 1px solid var(--st-border);
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    box-shadow: 0 5px 15px -3px var(--st-shadow);
    font-size: 0.8125rem;
  }

  .saved-popup-content svg path {
    stroke: var(--st-success);
  }

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
    background: var(--st-bg);
    color: var(--st-text);
    border: 2px solid var(--st-border);
    border-radius: 0.125rem;
    outline: 0;
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    transition: background-color 0.15s ease;
  }

  .test-button:hover {
    background: var(--st-bg-secondary);
    color: var(--st-text);
  }

  .test-button:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--st-bg),
      0 0 0 4px var(--st-focus-ring);
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--st-border);
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

  .connection-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .check-connection-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    color: #fff;
    background: var(--st-btn-bg);
    border: 1px solid var(--st-btn-border);
    border-radius: 0.25rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
    white-space: nowrap;
  }

  .check-connection-btn:hover:not(:disabled) {
    background: var(--st-btn-hover-bg);
  }

  .check-connection-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .connection-status {
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .connection-status.connected {
    color: var(--st-success);
  }

  .connection-status.error {
    color: #ef4444;
  }

  .section-title {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--st-text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 4px;
    padding: 0;
  }

  .env-indicator {
    background: var(--st-warning-surface);
    color: var(--st-warning-text);
    border: 1px solid var(--st-warning-border);
    padding: 8px 12px;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 500;
    margin-top: 4px;
  }
</style>
