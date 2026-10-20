<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { SUGGESTION_GROUPS, type SuggestionGroupId } from '../../lib/categories';
  import {
    addDictionaryWord,
    dictionaryToText,
    dictionaryWordFromQuote,
    DICTIONARY_WORD_LIMIT,
    DISABLED_GROUPS_KEY,
    mergeDictionary,
    normalizeDictionaryWord,
    parseDictionaryText,
    PERSONAL_DICTIONARY_KEY,
    readDictionary,
    readDisabledGroups,
    removeDictionaryWord,
  } from '../../lib/content/preferences';

  let words = $state<string[]>([]);
  let disabled = $state<SuggestionGroupId[]>([]);
  let query = $state('');
  let draft = $state('');
  let message = $state('');
  let fileInput = $state<HTMLInputElement | undefined>();

  let visible = $derived(
    words.filter((word) => normalizeDictionaryWord(word).includes(query.trim().toLowerCase()))
  );

  async function persistWords(next: string[]): Promise<void> {
    words = next;
    try {
      await browser.storage.local.set({ [PERSONAL_DICTIONARY_KEY]: next });
    } catch (error) {
      console.error('Failed to save the dictionary:', error);
      message = 'Could not save the dictionary.';
    }
  }

  async function persistDisabled(next: SuggestionGroupId[]): Promise<void> {
    disabled = next;
    try {
      await browser.storage.local.set({ [DISABLED_GROUPS_KEY]: next });
    } catch (error) {
      console.error('Failed to save suggestion groups:', error);
      message = 'Could not save suggestion groups.';
    }
  }

  function addWord(event: Event): void {
    event.preventDefault();
    const token = dictionaryWordFromQuote(draft);
    if (!token) {
      message = 'Enter a single word, without spaces.';
      return;
    }
    if (words.some((word) => normalizeDictionaryWord(word) === normalizeDictionaryWord(token))) {
      message = 'That word is already in the dictionary.';
      return;
    }
    const next = addDictionaryWord(words, token);
    if (next.length === words.length) {
      message = `The dictionary is limited to ${DICTIONARY_WORD_LIMIT} words.`;
      return;
    }
    draft = '';
    message = `Added "${token}".`;
    void persistWords(next);
  }

  function removeWord(word: string): void {
    message = '';
    void persistWords(removeDictionaryWord(words, word));
  }

  function toggleGroup(group: SuggestionGroupId): void {
    const next = disabled.includes(group)
      ? disabled.filter((item) => item !== group)
      : [...disabled, group];
    void persistDisabled(next);
  }

  async function importFile(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const before = words.length;
      const next = mergeDictionary(words, parseDictionaryText(text));
      const added = next.length - before;
      message =
        added === 0
          ? 'No new words in that file.'
          : `Imported ${added} ${added === 1 ? 'word' : 'words'}.`;
      await persistWords(next);
    } catch (error) {
      console.error('Failed to import the dictionary:', error);
      message = 'Could not read that file.';
    }
  }

  function exportDictionary(): void {
    const blob = new Blob([dictionaryToText(words)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'safetyper-dictionary.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  onMount(() => {
    void (async () => {
      try {
        const stored = await browser.storage.local.get([
          PERSONAL_DICTIONARY_KEY,
          DISABLED_GROUPS_KEY,
        ]);
        words = readDictionary(stored[PERSONAL_DICTIONARY_KEY]);
        disabled = readDisabledGroups(stored[DISABLED_GROUPS_KEY]);
      } catch (error) {
        console.error('Failed to load writing preferences:', error);
      }
    })();

    const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      if (PERSONAL_DICTIONARY_KEY in changes) {
        words = readDictionary(changes[PERSONAL_DICTIONARY_KEY]?.newValue);
      }
      if (DISABLED_GROUPS_KEY in changes) {
        disabled = readDisabledGroups(changes[DISABLED_GROUPS_KEY]?.newValue);
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
    };
  });
</script>

<section id="dictionary-section" class="pref-section" aria-labelledby="dictionary-heading">
  <div class="section-title">
    <h3 id="dictionary-heading">Personal dictionary</h3>
    <span class="count">{words.length} {words.length === 1 ? 'word' : 'words'}</span>
  </div>
  <p class="help-text">
    Spelling cards can add a word. Matching words are not flagged again, including in later checks.
  </p>
  <label class="sr" for="dictionary-search">Search dictionary</label>
  <input
    id="dictionary-search"
    class="input"
    type="search"
    placeholder="Search words"
    bind:value={query}
  />
  <ul class="word-list">
    {#each visible as word (normalizeDictionaryWord(word))}
      <li class="word-row">
        <span>{word}</span>
        <button
          type="button"
          class="remove-btn"
          aria-label={`Remove ${word}`}
          onclick={() => removeWord(word)}>Remove</button
        >
      </li>
    {:else}
      <li class="empty">
        {query.trim()
          ? 'No matching words.'
          : 'No words yet. Add one from a spelling card, or import a .txt file.'}
      </li>
    {/each}
  </ul>
  <form class="add-row" onsubmit={addWord}>
    <label class="sr" for="dictionary-add">Add a word</label>
    <input
      id="dictionary-add"
      class="input"
      type="text"
      placeholder="Add a word"
      bind:value={draft}
    />
    <button class="secondary-btn small" type="submit">Add</button>
  </form>
  <div class="button-row">
    <button type="button" class="secondary-btn small" onclick={() => fileInput?.click()}>
      Import .txt
    </button>
    <button
      type="button"
      class="secondary-btn small"
      onclick={exportDictionary}
      disabled={words.length === 0}
    >
      Export .txt
    </button>
  </div>
  <input
    bind:this={fileInput}
    class="file-input"
    type="file"
    accept=".txt,text/plain"
    aria-label="Import dictionary text file"
    onchange={(event) => void importFile(event)}
  />
  {#if message}
    <p class="status" role="status">{message}</p>
  {/if}
</section>

<section id="category-section" class="pref-section" aria-labelledby="category-heading">
  <h3 id="category-heading">Suggestion groups</h3>
  <p class="help-text">Turn a group off to hide those suggestions.</p>
  <div class="checks" role="group" aria-labelledby="category-heading">
    {#each SUGGESTION_GROUPS as group (group.id)}
      <label class="check-row">
        <input
          type="checkbox"
          checked={!disabled.includes(group.id)}
          onchange={() => toggleGroup(group.id)}
        />
        <span>{group.label}</span>
      </label>
    {/each}
  </div>
</section>

<style>
  .pref-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--st-border);
  }

  .section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--st-text);
  }

  .count {
    color: var(--st-text-muted);
    font-size: 12px;
  }

  .word-list {
    max-height: 148px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    border-radius: 8px;
    background: var(--st-bg);
    box-shadow: 0 0 0 1px var(--st-border);
  }

  .word-row,
  .empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    font-size: 13px;
  }

  .word-row + .word-row {
    box-shadow: inset 0 1px 0 var(--st-border);
  }

  .empty {
    color: var(--st-text-secondary);
    line-height: 1.35;
  }

  .remove-btn {
    border: 0;
    background: transparent;
    color: var(--st-text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .remove-btn:hover {
    color: var(--st-error);
  }

  .remove-btn:focus-visible,
  .check-row:focus-within {
    outline: 1px solid var(--st-focus-ring);
    outline-offset: 2px;
  }

  .add-row,
  .button-row,
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .add-row .input {
    flex: 1;
    min-width: 0;
  }

  .checks {
    flex-direction: column;
    gap: 6px;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    padding: 2px 4px;
    border-radius: 6px;
    color: var(--st-text);
    font-size: 14px;
  }

  .check-row input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--st-brand);
  }

  .status {
    margin: 0;
    color: var(--st-text-secondary);
    font-size: 12px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
