<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import type { ApiProvider, OpenRouterModel } from '../../../lib/content/types';
  import { PROVIDER_CONFIG, DEFAULT_PROVIDER } from '../../../lib/content/config';

  interface Props {
    onNext: () => void;
    onBack: () => void;
    onSkip: () => Promise<void>;
  }

  let { onNext, onBack, onSkip }: Props = $props();

  // Storage items (same pattern as popup)
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
  const hasCompletedOnboardingStorage = storage.defineItem<boolean>(
    'local:hasCompletedOnboarding',
    { fallback: false }
  );

  // Fallback models
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
  let ollamaEndpoint = $state('http://localhost:11434');
  let isSaving = $state(false);
  let connectionStatus: 'idle' | 'checking' | 'connected' | 'error' = $state('idle');
  let connectionError = $state('');
  let connectionModelCount = $state(0);

  // Model combobox state
  let allModels: OpenRouterModel[] = $state(OPENROUTER_FALLBACK_MODELS);
  let isLoadingModels = $state(false);
  let searchQuery = $state('');
  let isDropdownOpen = $state(false);
  let highlightedIndex = $state(-1);
  let comboboxEl: HTMLDivElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();

  let providerConfig = $derived(PROVIDER_CONFIG[selectedProvider]);
  let isOllama = $derived(selectedProvider === 'ollama');
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

    allModels = getFallbackModels(newProvider);
    await fetchModels();
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

  async function saveAndContinue() {
    isSaving = true;
    try {
      if (!isOllama && apiKey && apiKey.trim() !== '') {
        const validation = validateApiKey(apiKey);
        if (!validation.valid) {
          alert(validation.error);
          isSaving = false;
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

      await hasCompletedOnboardingStorage.setValue(true);
      onNext();
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      isSaving = false;
    }
  }

  onMount(async () => {
    try {
      selectedProvider = (await selectedProviderStorage.getValue()) || DEFAULT_PROVIDER;
      const config = PROVIDER_CONFIG[selectedProvider];

      if (selectedProvider === 'ollama') {
        selectedModel = (await ollamaSelectedModelStorage.getValue()) || config.defaultModel;
        ollamaEndpoint = (await ollamaEndpointStorage.getValue()) || 'http://localhost:11434';
      } else if (selectedProvider === 'openrouter') {
        selectedModel = (await selectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await openRouterKeyStorage.getValue()) || '';
      } else {
        selectedModel = (await groqSelectedModelStorage.getValue()) || config.defaultModel;
        apiKey = (await groqKeyStorage.getValue()) || '';
      }

      allModels = getFallbackModels(selectedProvider);
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

<div class="setup">
  <h2>Configure your provider</h2>
  <p class="subtitle">Choose an AI provider and enter your credentials to get started.</p>

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
        <option value="ollama">Ollama (Local)</option>
      </select>
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
          oninput={(e: Event) => {
            apiKey = (e.target as HTMLInputElement).value;
          }}
        />
        <p class="help-text">
          Get your API key from <a href={providerConfig.keysUrl} target="_blank"
            >{providerConfig.name}</a
          >
        </p>
      </div>
    {/if}

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
              d="M3 4.5L6 7.5L9 4.5"
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
              </li>
            {/each}
            {#if filteredModels.length === 0}
              <li class="no-results">No models found</li>
            {/if}
          </ul>
        {/if}
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="primary-btn" onclick={saveAndContinue} disabled={isSaving}>
      {isSaving ? 'Saving...' : 'Save & Continue'}
    </button>
    <div class="secondary-actions">
      <button class="text-btn" onclick={onBack}>Back</button>
      <button class="text-btn" onclick={onSkip}>Skip</button>
    </div>
  </div>
</div>

<style>
  .setup {
    max-width: 480px;
    margin: 0 auto;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--st-text);
    margin-bottom: 6px;
    text-align: center;
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--st-text-secondary);
    text-align: center;
    margin-bottom: 28px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 28px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--st-text);
  }

  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .select,
  .input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--st-border);
    border-radius: 8px;
    font-size: 0.875rem;
    background: var(--st-bg);
    color: var(--st-text);
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .select {
    appearance: none;
    background-image: var(--st-select-arrow);
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
  }

  .select:focus,
  .input:focus {
    border-color: var(--st-brand);
    box-shadow: 0 0 0 2px var(--st-brand-surface);
  }

  .help-text {
    font-size: 0.75rem;
    color: var(--st-text-secondary);
  }

  .help-text a {
    color: var(--st-brand);
    text-decoration: none;
  }

  .help-text a:hover {
    text-decoration: underline;
  }

  .connection-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }

  .status-text {
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-text.connected {
    color: var(--st-success);
  }

  .status-text.error {
    color: #ef4444;
  }

  .refresh-btn {
    background: none;
    border: none;
    color: var(--st-brand);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
  }

  .refresh-btn:hover:not(:disabled) {
    text-decoration: underline;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Combobox */
  .combobox {
    position: relative;
    width: 100%;
  }

  .combobox-input {
    width: 100%;
    padding: 10px 36px 10px 12px;
    border: 1px solid var(--st-border);
    border-radius: 8px;
    font-size: 0.875rem;
    background: var(--st-bg);
    color: var(--st-text);
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .combobox-input:focus {
    border-color: var(--st-brand);
    box-shadow: 0 0 0 2px var(--st-brand-surface);
  }

  .combobox-toggle {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--st-text-secondary);
    display: flex;
    align-items: center;
  }

  .combobox-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--st-bg-elevated);
    border: 1px solid var(--st-border);
    border-radius: 8px;
    list-style: none;
    padding: 4px;
    z-index: 10;
    box-shadow: 0 4px 12px var(--st-shadow);
  }

  .combobox-list li {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--st-text);
    transition: background 0.1s ease;
  }

  .combobox-list li:hover,
  .combobox-list li.highlighted {
    background: var(--st-bg-secondary);
  }

  .combobox-list li.selected {
    background: var(--st-brand-surface);
    color: var(--st-brand-text);
    font-weight: 500;
  }

  .combobox-list li.no-results {
    color: var(--st-text-secondary);
    cursor: default;
    text-align: center;
    font-style: italic;
  }

  .model-name {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .primary-btn {
    width: 100%;
    padding: 12px 24px;
    background: var(--st-btn-bg);
    color: #fff;
    border: 2px solid var(--st-btn-border);
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .primary-btn:hover:not(:disabled) {
    background: var(--st-btn-hover-bg);
  }

  .primary-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .secondary-actions {
    display: flex;
    gap: 16px;
  }

  .secondary-btn {
    padding: 8px 16px;
    background: var(--st-bg-secondary);
    color: var(--st-text);
    border: 1px solid var(--st-border);
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .secondary-btn.small {
    padding: 6px 12px;
    font-size: 0.75rem;
  }

  .secondary-btn:hover:not(:disabled) {
    background: var(--st-bg-elevated);
  }

  .secondary-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--st-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    padding: 4px 8px;
    transition: color 0.15s ease;
  }

  .text-btn:hover {
    color: var(--st-text);
  }
</style>
