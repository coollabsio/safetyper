<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import { TranslateError, translateText } from '../../lib/translate/client';
  import {
    AUTO_DETECT,
    LANGUAGES,
    defaultTargetFromUiLanguage,
    isLanguageCode,
  } from '../../lib/translate/languages';
  import type { TranslationAlternative } from '../../lib/translate/types';

  interface Props {
    onOpenSettings: () => void;
  }

  let { onOpenSettings }: Props = $props();

  const sourceStorage = storage.defineItem<string>('local:translateSourceLanguage', {
    fallback: AUTO_DETECT,
  });
  const targetStorage = storage.defineItem<string>('local:translateTargetLanguage');
  const draftStorage = storage.defineItem<string>('local:translateDraft', { fallback: '' });
  const resultStorage = storage.defineItem<string>('local:translateResult', { fallback: '' });
  const detectedStorage = storage.defineItem<string>('local:translateDetectedLanguage', {
    fallback: '',
  });
  const alternativesStorage = storage.defineItem<TranslationAlternative[]>(
    'local:translateAlternatives',
    { fallback: [] }
  );

  const shortcutLabel = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘+Enter' : 'Ctrl+Enter';

  let sourceLanguage = $state(AUTO_DETECT);
  let targetLanguage = $state('en');
  let inputText = $state('');
  let output = $state('');
  let detectedLanguage = $state('');
  let alternatives = $state<TranslationAlternative[]>([]);
  let loading = $state(false);
  let error = $state('');
  let errorOpensSettings = $state(false);
  let copied = $state(false);
  let requestSeq = 0;
  let copyTimer = 0;

  let canSwap = $derived(sourceLanguage !== AUTO_DETECT);
  let panelState = $derived(loading ? 'loading' : error ? 'error' : output ? 'result' : 'empty');

  function readStoredAlternatives(value: unknown): TranslationAlternative[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is TranslationAlternative =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as TranslationAlternative).text === 'string' &&
        typeof (item as TranslationAlternative).meaning === 'string'
    );
  }

  async function persistLanguages(): Promise<void> {
    await Promise.all([
      sourceStorage.setValue(sourceLanguage),
      targetStorage.setValue(targetLanguage),
    ]);
  }

  async function persistSession(): Promise<void> {
    await Promise.all([
      draftStorage.setValue(inputText),
      resultStorage.setValue(output),
      detectedStorage.setValue(detectedLanguage),
      alternativesStorage.setValue(alternatives),
    ]);
  }

  function handleInput(event: Event): void {
    inputText = (event.currentTarget as HTMLTextAreaElement).value;
    void draftStorage.setValue(inputText);
  }

  async function handleSourceChange(event: Event): Promise<void> {
    sourceLanguage = (event.currentTarget as HTMLSelectElement).value;
    await persistLanguages();
  }

  async function handleTargetChange(event: Event): Promise<void> {
    const next = (event.currentTarget as HTMLSelectElement).value;
    if (!isLanguageCode(next)) return;
    targetLanguage = next;
    await targetStorage.setValue(targetLanguage);
  }

  async function swapLanguages(): Promise<void> {
    if (!canSwap || !isLanguageCode(targetLanguage)) return;
    const previousSource = sourceLanguage;
    sourceLanguage = targetLanguage;
    targetLanguage = previousSource;
    if (output) {
      const previousInput = inputText;
      inputText = output;
      output = previousInput;
      alternatives = [];
      detectedLanguage = '';
    }
    error = '';
    errorOpensSettings = false;
    await Promise.all([persistLanguages(), persistSession()]);
  }

  async function runTranslation(): Promise<void> {
    if (loading || !inputText.trim()) return;
    const id = ++requestSeq;
    loading = true;
    error = '';
    errorOpensSettings = false;
    try {
      const result = await translateText(inputText, sourceLanguage, targetLanguage);
      if (id !== requestSeq) return;
      output = result.translation;
      detectedLanguage = result.detectedSourceLanguage ?? '';
      alternatives = result.alternatives;
      await persistSession();
    } catch (caught) {
      if (id !== requestSeq) return;
      output = '';
      alternatives = [];
      detectedLanguage = '';
      if (caught instanceof TranslateError) {
        error = caught.message;
        errorOpensSettings = caught.opensSettings;
      } else {
        error = 'Translation failed. Try again.';
        errorOpensSettings = false;
      }
    } finally {
      if (id === requestSeq) loading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void runTranslation();
  }

  async function copyResult(): Promise<void> {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      copied = true;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        copied = false;
      }, 1500);
    } catch (caught) {
      console.error('Failed to copy translation:', caught);
      error = 'Could not copy the translation.';
      errorOpensSettings = false;
    }
  }

  async function clearInput(): Promise<void> {
    requestSeq += 1;
    loading = false;
    inputText = '';
    output = '';
    detectedLanguage = '';
    alternatives = [];
    error = '';
    errorOpensSettings = false;
    copied = false;
    await persistSession();
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKeydown);
    try {
      const [storedSource, storedTarget, storedDraft, storedResult, storedDetected, storedAlts] =
        await Promise.all([
          sourceStorage.getValue(),
          targetStorage.getValue(),
          draftStorage.getValue(),
          resultStorage.getValue(),
          detectedStorage.getValue(),
          alternativesStorage.getValue(),
        ]);

      sourceLanguage =
        storedSource === AUTO_DETECT || isLanguageCode(storedSource) ? storedSource : AUTO_DETECT;
      targetLanguage =
        storedTarget && isLanguageCode(storedTarget)
          ? storedTarget
          : defaultTargetFromUiLanguage(browser.i18n.getUILanguage());
      inputText = storedDraft ?? '';
      output = storedResult ?? '';
      detectedLanguage = storedDetected ?? '';
      alternatives = readStoredAlternatives(storedAlts);

      if (!storedTarget || !isLanguageCode(storedTarget)) {
        await targetStorage.setValue(targetLanguage);
      }
    } catch (caught) {
      console.error('Failed to restore translation:', caught);
    }
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.clearTimeout(copyTimer);
    void draftStorage.setValue(inputText);
  });
</script>

<div class="translate" data-state={panelState}>
  <div class="field">
    <div class="label-row">
      <label for="source-language">From</label>
      {#if canSwap}
        <button
          type="button"
          class="swap-btn"
          aria-label="Swap languages"
          title="Swap languages"
          onclick={() => void swapLanguages()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 7h11M16 4l3 3-3 3M17 17H6M8 14l-3 3 3 3"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Swap
        </button>
      {/if}
    </div>
    <select
      id="source-language"
      class="select"
      value={sourceLanguage}
      onchange={(event) => void handleSourceChange(event)}
    >
      <option value={AUTO_DETECT}>Detect automatically</option>
      {#each LANGUAGES as language (language.code)}
        <option value={language.code}>{language.name}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <label for="target-language">To</label>
    <select
      id="target-language"
      class="select"
      value={targetLanguage}
      onchange={(event) => void handleTargetChange(event)}
    >
      {#each LANGUAGES as language (language.code)}
        <option value={language.code}>{language.name}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <div class="label-row">
      <label for="translate-input">Text</label>
      {#if inputText}
        <button type="button" class="refresh-btn" onclick={() => void clearInput()}>Clear</button>
      {/if}
    </div>
    <textarea
      id="translate-input"
      class="input"
      rows="3"
      placeholder="Type or paste a word or sentence"
      value={inputText}
      oninput={handleInput}
    ></textarea>
  </div>

  <div class="field">
    <button
      type="button"
      id="translate-button"
      class="primary-btn translate-btn"
      onclick={() => void runTranslation()}
      disabled={loading}
      aria-keyshortcuts="Control+Enter Meta+Enter"
    >
      {#if loading}
        <span class="btn-spinner" aria-hidden="true"></span>
      {/if}
      {loading ? 'Translating...' : 'Translate'}
    </button>
    <p class="help-text">{shortcutLabel} to translate. Uses the model from Settings.</p>
  </div>

  <div class="field">
    <div class="label-row">
      <span class="field-label" id="translation-label">Translation</span>
      {#if output && !loading && !error}
        <button type="button" class="refresh-btn" onclick={() => void copyResult()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      {/if}
    </div>
    <div
      class="output"
      class:is-error={!!error && !loading}
      role="status"
      aria-live="polite"
      aria-labelledby="translation-label"
      aria-busy={loading}
    >
      {#if loading}
        <p class="placeholder">Translating...</p>
      {:else if error}
        <p class="error-text">{error}</p>
        {#if errorOpensSettings}
          <button type="button" class="settings-link" onclick={() => onOpenSettings()}>
            Open Settings
          </button>
        {/if}
      {:else if output}
        <p class="output-text">{output}</p>
        {#if sourceLanguage === AUTO_DETECT && detectedLanguage}
          <p class="detected">Detected {detectedLanguage}</p>
        {/if}
        {#if alternatives.length > 0}
          <div class="alternatives">
            <h3>Other meanings</h3>
            <ul>
              {#each alternatives as alternative (alternative.text)}
                <li>
                  <span class="alt-text">{alternative.text}</span>
                  {#if alternative.meaning}
                    <span class="alt-meaning"> — {alternative.meaning}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else}
        <p class="placeholder">Translation will show up here.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .translate {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field label,
  .field-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--st-text-secondary);
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.25rem;
  }

  .swap-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 1.25rem;
    padding: 0 2px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--st-brand);
    background: none;
    border: none;
    cursor: pointer;
  }

  .swap-btn:hover {
    color: var(--st-text);
    text-decoration: underline;
  }

  .swap-btn:focus-visible {
    outline: 1px solid var(--st-focus-ring);
    outline-offset: 2px;
  }

  textarea.input {
    min-height: 4.5rem;
    resize: vertical;
    line-height: 1.4;
  }

  .translate-btn:disabled {
    color: var(--st-primary-text);
    background: linear-gradient(to bottom, var(--st-primary-from), var(--st-primary-to));
    border-color: var(--st-primary-border);
    box-shadow: 0 2px 0 var(--st-primary-depth);
    cursor: progress;
    opacity: 0.9;
  }

  .btn-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgb(255 255 255 / 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .output {
    min-height: 4.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: var(--st-input-bg);
    box-shadow: 0 0 0 1px var(--st-line);
  }

  .output.is-error {
    background: color-mix(in srgb, var(--st-error) 10%, var(--st-base));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-error) 40%, transparent);
  }

  .output-text,
  .placeholder,
  .error-text,
  .detected {
    margin: 0;
  }

  .output-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--st-text);
  }

  .placeholder {
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--st-text-muted);
  }

  .error-text {
    font-size: 13px;
    line-height: 1.4;
    color: var(--st-error);
  }

  .settings-link {
    align-self: flex-start;
    margin-top: 8px;
    padding: 0;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--st-brand);
    background: none;
    border: none;
    cursor: pointer;
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  .settings-link:focus-visible {
    outline: 1px solid var(--st-focus-ring);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .detected {
    margin-top: 8px;
    font-size: 12px;
    color: var(--st-text-secondary);
  }

  .alternatives {
    margin-top: 10px;
    padding-top: 8px;
    box-shadow: inset 0 1px 0 var(--st-border);
  }

  .alternatives h3 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--st-text-muted);
  }

  .alternatives ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .alternatives li {
    font-size: 13px;
    line-height: 1.45;
    color: var(--st-text);
  }

  .alt-text {
    font-weight: 600;
  }

  .alt-meaning {
    color: var(--st-text-secondary);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .btn-spinner {
      animation: none;
    }
  }
</style>
