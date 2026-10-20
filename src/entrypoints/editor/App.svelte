<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { storage } from '#imports';
  import { browser } from 'wxt/browser';
  import { groupLabel } from '~/lib/categories';
  import { applyGroupColorVariables } from '~/lib/content/category-colors';
  import { ChatError, OLLAMA_ORIGINS_VALUE, resolveProvider } from '~/lib/ai/chat';
  import { isAbortError, OLLAMA_LOADING_HINT_MS } from '~/lib/ai/timeout';
  import type { ApiProvider } from '~/lib/content/types';
  import { fetchIssues } from '~/lib/editor/check';
  import {
    createDocument,
    deleteDocument,
    listDocuments,
    saveDocument,
    type StoredDocument,
  } from '~/lib/editor/documents';
  import {
    collectBlocks,
    createSuggestionExtension,
    locateIssue,
    ParagraphIds,
    type SuggestionHandlers,
  } from '~/lib/editor/extensions';
  import {
    chunkParagraphs,
    chunkText,
    issueKey,
    IssueParseError,
    matchIssues,
    ParagraphSnapshot,
    readabilityStats,
    type MatchedIssue,
  } from '~/lib/editor/issues';
  import {
    emptyDocument,
    exportDocument,
    importPlainText,
    type ImportKind,
  } from '~/lib/editor/markdown';

  const darkModeStorage = storage.defineItem<boolean>('local:darkMode', { fallback: false });
  const RECHECK_PAUSE_MS = 1500;

  let screen = $state<'list' | 'edit'>('list');
  let documents = $state<StoredDocument[]>([]);
  let active = $state<StoredDocument | null>(null);
  let title = $state('');
  let darkMode = $state(false);
  let providerLabel = $state('');
  let providerId = $state<ApiProvider>('openrouter');
  let loadToken = 0;
  let issues = $state<MatchedIssue[]>([]);
  let activeKey = $state<string | null>(null);
  let checking = $state(false);
  let statsLabel = $state('0 words · 0 characters');
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let card = $state<{ top: number; left: number; issue: MatchedIssue } | null>(null);
  let status = $state<
    | { kind: 'idle' }
    | { kind: 'checking'; message: string }
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string }
    | { kind: 'bad-json'; message: string }
    | { kind: 'ollama'; message: string }
  >({ kind: 'idle' });

  let editorHost: HTMLDivElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let editor: Editor | null = null;
  let saveTimer: number | null = null;
  let recheckTimer: number | null = null;
  let abort: AbortController | null = null;
  let suppress = false;
  let autoRecheck = false;
  const checkedText = new ParagraphSnapshot();

  const handlers: SuggestionHandlers = {
    issues: [],
    activeKey: null,
    onSelect: (key) => selectIssue(key),
    onKeyDown: (event) => handleChord(event),
  };

  function applyTheme(isDark: boolean): void {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    applyGroupColorVariables(isDark ? 'dark' : 'light');
  }

  async function toggleDarkMode(): Promise<void> {
    darkMode = !darkMode;
    await darkModeStorage.setValue(darkMode);
    applyTheme(darkMode);
  }

  function syncHandlers(): void {
    handlers.issues = issues;
    handlers.activeKey = activeKey;
  }

  function refreshDecorations(): void {
    syncHandlers();
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta('safetyper-refresh', true));
  }

  function updateStats(): void {
    const text = editor ? editor.getText({ blockSeparator: '\n' }) : '';
    const stats = readabilityStats(text);
    const ease = stats.flesch === null ? '—' : String(stats.flesch);
    statsLabel = `${stats.words} words · ${stats.characters} characters · reading ease ${ease}`;
  }

  function currentBlocks(): ReturnType<typeof collectBlocks> {
    if (!editor) return [];
    return collectBlocks(editor.state.doc);
  }

  function scheduleSave(): void {
    if (!editor || !active) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void persist();
    }, 400);
  }

  async function persist(): Promise<void> {
    if (!editor || !active) return;
    const updated: StoredDocument = {
      ...active,
      title: title.trim() || 'Untitled',
      content: editor.getJSON(),
      updatedAt: Date.now(),
    };
    await saveDocument(updated);
    active = updated;
  }

  function placeCard(): void {
    const issue = issues.find((item) => issueKey(item) === activeKey);
    if (!editor || !issue) {
      card = null;
      return;
    }
    const range = locateIssue(collectBlocks(editor.state.doc), issue);
    if (!range) {
      card = null;
      return;
    }
    const start = editor.view.coordsAtPos(range.from);
    const end = editor.view.coordsAtPos(Math.max(range.from, range.to - 1));
    const width = 300;
    const height = 168;
    const paper = editorHost?.getBoundingClientRect();
    const paperRight = paper?.right ?? window.innerWidth - 16;
    const lineBottom = Math.max(start.bottom, end.bottom);
    const lineTop = Math.min(start.top, end.top);
    // Sit under the quote, on the right side of the page, so a left-edge underline stays readable.
    let left = paperRight - width - 16;
    let top = lineBottom + 12;
    if (left < 12) left = 12;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top + height > window.innerHeight - 8) {
      const above = lineTop - height - 12;
      if (above >= 8) top = above;
    }
    card = { top, left, issue };
  }

  function selectIssue(key: string): void {
    activeKey = key;
    refreshDecorations();
    placeCard();
  }

  function selectRelative(direction: 1 | -1): void {
    if (!editor || issues.length === 0) return;
    const blocks = collectBlocks(editor.state.doc);
    const ordered = issues
      .map((issue) => ({ issue, range: locateIssue(blocks, issue) }))
      .filter((item) => item.range !== null)
      .sort((a, b) => (a.range?.from ?? 0) - (b.range?.from ?? 0));
    if (ordered.length === 0) return;
    const current = ordered.findIndex((item) => issueKey(item.issue) === activeKey);
    const next = ordered[(current + direction + ordered.length) % ordered.length];
    selectIssue(issueKey(next.issue));
  }

  function handleChord(event: KeyboardEvent): boolean {
    if (event.key === 'Tab') return false;
    if (!active) return false;
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      selectRelative(1);
      return true;
    }
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      selectRelative(-1);
      return true;
    }
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault();
      const issue = issues.find((item) => issueKey(item) === activeKey) ?? issues[0];
      if (issue) acceptIssue(issue);
      return true;
    }
    if (event.key === 'Escape' && activeKey) {
      event.preventDefault();
      const issue = issues.find((item) => issueKey(item) === activeKey);
      if (issue) dismissIssue(issue);
      return true;
    }
    return false;
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select')) return;
    handleChord(event);
  }

  function mountEditor(document: StoredDocument): void {
    editor?.destroy();
    if (!editorHost) return;
    issues = [];
    activeKey = null;
    card = null;
    autoRecheck = false;
    status = { kind: 'idle' };
    syncHandlers();
    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({ link: false }),
        ParagraphIds,
        createSuggestionExtension(handlers),
      ],
      content: document.content,
      editorProps: {
        attributes: {
          class: 'safetyper-prose',
          'aria-label': 'Document',
          spellcheck: 'true',
        },
      },
      onUpdate: () => {
        updateStats();
        scheduleSave();
        if (!suppress) scheduleDirty();
      },
    });
    checkedText.replace(currentBlocks());
    updateStats();
  }

  async function refreshList(): Promise<void> {
    documents = await listDocuments();
  }

  async function openDocument(document: StoredDocument): Promise<void> {
    active = document;
    title = document.title;
    screen = 'edit';
    await tick();
    mountEditor(document);
    await refreshProvider();
  }

  async function closeDocument(): Promise<void> {
    abort?.abort();
    await persist();
    editor?.destroy();
    editor = null;
    card = null;
    screen = 'list';
    await refreshList();
  }

  async function newDocument(): Promise<void> {
    const document = await createDocument({ title: 'Untitled', content: emptyDocument() });
    await openDocument(document);
  }

  function startRename(document: StoredDocument): void {
    renamingId = document.id;
    renameDraft = document.title;
  }

  async function commitRename(document: StoredDocument): Promise<void> {
    const nextTitle = renameDraft.trim() || 'Untitled';
    renamingId = null;
    if (nextTitle === document.title) return;
    await saveDocument({ ...document, title: nextTitle, updatedAt: Date.now() });
    await refreshList();
  }

  async function removeDocument(document: StoredDocument): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${document.title}"? This removes it from this browser profile.`
    );
    if (!confirmed) return;
    await deleteDocument(document.id);
    await refreshList();
  }

  function dirtyIds(): string[] {
    return checkedText.dirtyIds(currentBlocks());
  }

  function scheduleDirty(): void {
    if (!autoRecheck || !editor) return;
    if (recheckTimer !== null) window.clearTimeout(recheckTimer);
    recheckTimer = window.setTimeout(() => {
      if (checking) {
        scheduleDirty();
        return;
      }
      const dirty = dirtyIds();
      if (dirty.length === 0) return;
      void runCheck(dirty);
    }, RECHECK_PAUSE_MS);
  }

  async function refreshProvider(): Promise<void> {
    try {
      const resolved = await resolveProvider();
      providerId = resolved.provider;
      providerLabel = `${resolved.providerName} · ${resolved.model}`;
    } catch (error) {
      console.error('Failed to read provider settings', error);
      providerLabel = 'Provider unavailable';
    }
  }

  async function runCheck(only?: string[]): Promise<void> {
    if (!editor) return;
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    checking = true;
    card = null;
    const token = ++loadToken;
    armLoadHint(token);
    const blocks = collectBlocks(editor.state.doc).filter((block) => block.text.trim().length > 0);
    const targets = only ? blocks.filter((block) => only.includes(block.id)) : blocks;
    const chunks = chunkParagraphs(targets.map((block) => ({ id: block.id, text: block.text })));

    if (chunks.length === 0) {
      checking = false;
      if (loadToken === token) loadToken += 1;
      if (!only) {
        issues = [];
        syncHandlers();
        refreshDecorations();
      }
      status = { kind: 'ok', message: 'Nothing to check.' };
      return;
    }

    const found: MatchedIssue[] = [];
    let parseFailures = 0;
    let rawCount = 0;
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (controller.signal.aborted) return;
        status = {
          kind: 'checking',
          message: `Checking paragraph ${index + 1} of ${chunks.length}…`,
        };
        try {
          const parsed = await fetchIssues(chunkText(chunks[index]), controller.signal);
          rawCount += parsed.length;
          found.push(...matchIssues(chunks[index].paragraphs, parsed));
        } catch (error) {
          if (error instanceof IssueParseError) {
            parseFailures += 1;
            continue;
          }
          throw error;
        }
      }

      const kept = only ? issues.filter((issue) => !only.includes(issue.paragraphId)) : [];
      issues = kept.concat(found);
      if (activeKey && !issues.some((issue) => issueKey(issue) === activeKey)) {
        activeKey = null;
        card = null;
      }
      checkedText.replace(currentBlocks());
      autoRecheck = true;
      refreshDecorations();

      if (parseFailures > 0 && found.length === 0) {
        status = {
          kind: 'bad-json',
          message:
            'This model did not return suggestions as JSON, even after one retry. Small models often ignore the format. Try a larger instruct model, then check again.',
        };
        return;
      }

      if (found.length === 0) {
        status = { kind: 'ok', message: 'Looks good' };
        return;
      }

      const unmatched = rawCount > found.length;
      const parts = [`${found.length} suggestion${found.length === 1 ? '' : 's'}.`];
      if (unmatched) {
        parts.push('Quotes that were not in the text were dropped.');
      }
      if (parseFailures > 0) {
        parts.push('One paragraph was skipped because the reply was not JSON.');
      }
      status = { kind: 'ok', message: parts.join(' ') };
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof ChatError && error.ollamaBlocked) {
        status = { kind: 'ollama', message: error.message };
        return;
      }
      const message = error instanceof Error ? error.message : 'The check failed.';
      status = { kind: 'error', message };
    } finally {
      if (loadToken === token) loadToken += 1;
      checking = false;
      if (autoRecheck && dirtyIds().length > 0) scheduleDirty();
    }
  }

  function armLoadHint(token: number): void {
    window.setTimeout(() => {
      if (token !== loadToken || !checking || providerId !== 'ollama') return;
      if (status.kind !== 'checking') return;
      status = { kind: 'checking', message: 'Loading model…' };
    }, OLLAMA_LOADING_HINT_MS);
  }

  function writeReplacement(from: number, to: number, replacement: string): void {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (replacement.length === 0) {
      chain.deleteRange({ from, to }).run();
      return;
    }
    chain.insertContentAt({ from, to }, { type: 'text', text: replacement }).run();
  }

  function acceptIssue(issue: MatchedIssue): void {
    if (!editor) return;
    const range = locateIssue(collectBlocks(editor.state.doc), issue);
    if (!range) {
      dismissIssue(issue);
      return;
    }
    suppress = true;
    writeReplacement(range.from, range.to, issue.replacement);
    suppress = false;
    issues = issues.filter((item) => issueKey(item) !== issueKey(issue));
    if (activeKey === issueKey(issue)) {
      activeKey = null;
      card = null;
    }
    const block = collectBlocks(editor.state.doc).find((item) => item.id === issue.paragraphId);
    if (block) checkedText.remember(issue.paragraphId, block.text);
    refreshDecorations();
    updateStats();
    scheduleSave();
  }

  function dismissIssue(issue: MatchedIssue): void {
    issues = issues.filter((item) => issueKey(item) !== issueKey(issue));
    if (activeKey === issueKey(issue)) {
      activeKey = null;
      card = null;
    }
    refreshDecorations();
  }

  function acceptAll(): void {
    if (!editor || issues.length === 0) return;
    const blocks = collectBlocks(editor.state.doc);
    const located = issues
      .map((issue) => ({ issue, range: locateIssue(blocks, issue) }))
      .filter((item): item is { issue: MatchedIssue; range: { from: number; to: number } } => {
        return item.range !== null;
      })
      .sort((a, b) => b.range.from - a.range.from);

    suppress = true;
    for (const item of located) {
      writeReplacement(item.range.from, item.range.to, item.issue.replacement);
    }
    suppress = false;
    issues = [];
    activeKey = null;
    card = null;
    status = { kind: 'ok', message: 'Applied the remaining suggestions.' };
    checkedText.replace(currentBlocks());
    refreshDecorations();
    updateStats();
    scheduleSave();
  }

  function openSettings(): void {
    browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
  }

  function exportAs(kind: ImportKind): void {
    if (!editor || !active) return;
    const text = exportDocument(editor.getJSON(), kind);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title.trim() || 'document').replace(/[\\/:*?"<>|]+/g, '-')}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function onImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const kind: ImportKind = file.name.toLowerCase().endsWith('.md') ? 'md' : 'txt';
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const name = file.name.replace(/\.(md|txt)$/i, '') || 'Imported';
      void createDocument({ title: name, content: importPlainText(text, kind) }).then((document) =>
        openDocument(document)
      );
    };
    reader.readAsText(file);
  }

  function onScroll(): void {
    if (card) placeCard();
  }

  onMount(async () => {
    darkMode = (await darkModeStorage.getValue()) ?? false;
    applyTheme(darkMode);
    await refreshProvider();
    await refreshList();
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
  });

  onDestroy(() => {
    abort?.abort();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    if (recheckTimer !== null) window.clearTimeout(recheckTimer);
    editor?.destroy();
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  });
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <img src="/icon/32.png" alt="" width="22" height="22" />
      <h1>SafeTyper</h1>
      <span class="provider-label">{providerLabel}</span>
    </div>
    <div class="top-actions">
      <button class="text-btn" type="button" onclick={openSettings}>Settings</button>
      <button
        class="theme-toggle"
        type="button"
        onclick={toggleDarkMode}
        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {darkMode ? 'Light' : 'Dark'}
      </button>
    </div>
  </header>

  {#if screen === 'list'}
    <main class="column">
      <div class="list-actions">
        <button class="primary-btn" type="button" onclick={newDocument}>New document</button>
        <button class="secondary-btn" type="button" onclick={() => fileInput?.click()}>
          Import .txt or .md
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          hidden
          onchange={onImport}
        />
      </div>

      {#if documents.length === 0}
        <section class="layer-card">
          <div class="layer-card-body empty-state">
            <h2>No documents yet</h2>
            <p class="empty-copy">Documents stay in this browser profile. They are not synced.</p>
          </div>
        </section>
      {:else}
        <div class="doc-list">
          {#each documents as document (document.id)}
            <article class="layer-card doc-row">
              {#if renamingId === document.id}
                <input
                  class="input rename-input"
                  bind:value={renameDraft}
                  aria-label="Document title"
                  onblur={() => commitRename(document)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void commitRename(document);
                    }
                  }}
                />
              {:else}
                <button class="doc-open" type="button" onclick={() => openDocument(document)}>
                  <strong>{document.title}</strong>
                  <span>{new Date(document.updatedAt).toLocaleString()}</span>
                </button>
              {/if}
              <div class="doc-actions">
                <button class="text-btn" type="button" onclick={() => startRename(document)}>
                  Rename
                </button>
                <button class="text-btn" type="button" onclick={() => removeDocument(document)}>
                  Delete
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </main>
  {:else}
    <main class="column">
      <div class="doc-bar">
        <button class="secondary-btn" type="button" onclick={closeDocument}>Documents</button>
        <input
          class="input title-input"
          bind:value={title}
          aria-label="Title"
          oninput={scheduleSave}
        />
        <button class="primary-btn" type="button" onclick={() => runCheck()} disabled={checking}>
          {checking ? 'Checking…' : 'Check'}
        </button>
        <button
          class="secondary-btn"
          type="button"
          onclick={acceptAll}
          disabled={issues.length === 0 || checking}
        >
          Accept all
        </button>
      </div>

      {#if status.kind !== 'idle'}
        <div class="banner {status.kind}" role="status">
          <div class="banner-row">
            <div>{status.message}</div>
            {#if status.kind === 'error' || status.kind === 'bad-json' || status.kind === 'ollama'}
              <button
                class="secondary-btn"
                type="button"
                onclick={() => runCheck()}
                disabled={checking}
              >
                Retry
              </button>
            {/if}
          </div>
          {#if status.kind === 'ollama'}
            <pre>OLLAMA_ORIGINS="{OLLAMA_ORIGINS_VALUE}"</pre>
          {/if}
        </div>
      {/if}

      <div class="paper" bind:this={editorHost}></div>

      <footer class="statusbar">
        <span>{statsLabel}</span>
        <span class="shortcuts"
          >Alt+Down next · Alt+Up previous · Alt+Enter accept · Esc dismiss</span
        >
        <span class="export-row">
          <button class="secondary-btn" type="button" onclick={() => exportAs('md')}>.md</button>
          <button class="secondary-btn" type="button" onclick={() => exportAs('txt')}>.txt</button>
        </span>
      </footer>
    </main>
  {/if}

  {#if card}
    <aside
      class="suggestion-card"
      data-group={card.issue.group}
      style:top="{card.top}px"
      style:left="{card.left}px"
    >
      <p class="category">{groupLabel(card.issue.group)}</p>
      <p class="quote-line">
        <del>{card.issue.quote}</del>
        <strong>{card.issue.replacement}</strong>
      </p>
      <p class="explanation">{card.issue.explanation}</p>
      <div class="card-actions">
        <button class="primary-btn" type="button" onclick={() => card && acceptIssue(card.issue)}>
          Accept
        </button>
        <button
          class="secondary-btn"
          type="button"
          onclick={() => card && dismissIssue(card.issue)}
        >
          Dismiss
        </button>
      </div>
    </aside>
  {/if}
</div>
