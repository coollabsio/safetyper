/**
 * Background wiring for selection translation: context menu, shortcut, and popup handoff.
 */

import { browser } from 'wxt/browser';
import { CONTENT_SCRIPT_EXCLUDE_MATCHES, sameMatchList } from '../content/page-guard';
import { defaultTargetFromUiLanguage, isLanguageCode, languageName } from '../translate/languages';
import { isTranslateHandoff, type TranslateHandoff } from './handoff';
import {
  CHANGE_LANGUAGE_TITLE,
  OPEN_SETTINGS_ACTION,
  OPEN_TRANSLATE_TAB_ACTION,
  SELECTION_TRANSLATE_PORT,
  TRANSLATE_ACTION_ID,
  TRANSLATE_CHANGE_LANGUAGE_ID,
  TRANSLATE_COMMAND,
  TRANSLATE_PARENT_ID,
  TRANSLATE_PARENT_TITLE,
  translateTargetMenuTitle,
} from './menu';

interface TranslatePort {
  sender?: { tab?: { id?: number }; frameId?: number };
  postMessage: (message: unknown) => void;
  onMessage: {
    addListener: (listener: (message: unknown) => void) => void;
    removeListener: (listener: (message: unknown) => void) => void;
  };
  onDisconnect: {
    addListener: (listener: () => void) => void;
  };
}

interface StatusMessage {
  type: 'selection-status';
  requestId: number;
  hasText: boolean;
  text: string;
}

const ports = new Set<TranslatePort>();
let menuTask: Promise<void> = Promise.resolve();
let requestSeq = 0;

export function installSelectionTranslate(): void {
  browser.runtime.onConnect.addListener((connection) => {
    if (connection.name !== SELECTION_TRANSLATE_PORT) return;
    const port = connection as TranslatePort;
    ports.add(port);
    connection.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender.id || sender.id !== browser.runtime.id) return;
    const action = readAction(message);
    if (action === OPEN_TRANSLATE_TAB_ACTION) {
      const record = asRecord(message);
      const text = typeof record.text === 'string' ? record.text : '';
      const translation = typeof record.translation === 'string' ? record.translation : '';
      void openTranslateSurface(text, translation)
        .then(() => sendResponse({ success: true }))
        .catch((error: unknown) => {
          console.error('[SafeTyper] Could not open the Translate tab:', error);
          sendResponse({ success: false });
        });
      return true;
    }
    if (action === OPEN_SETTINGS_ACTION) {
      void openSettingsSurface()
        .then(() => sendResponse({ success: true }))
        .catch((error: unknown) => {
          console.error('[SafeTyper] Could not open Settings:', error);
          sendResponse({ success: false });
        });
      return true;
    }
    return undefined;
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== TRANSLATE_COMMAND) return;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await askPageToTranslate(tab.id, undefined, '');
    })().catch((error: unknown) => {
      console.error('[SafeTyper] Translate shortcut failed:', error);
    });
  });

  if (!browser.contextMenus) {
    console.error('[SafeTyper] contextMenus is not available in this browser.');
  } else {
    void ensureMenu();
    browser.runtime.onInstalled.addListener(() => {
      void ensureMenu();
    });
    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (!tab?.id) return;
      const itemId = String(info.menuItemId);
      const hint = info.selectionText ?? '';
      if (itemId === TRANSLATE_CHANGE_LANGUAGE_ID) {
        void openChangeLanguage(tab.id, info.frameId, hint).catch((error: unknown) => {
          console.error('[SafeTyper] Could not open the language picker:', error);
        });
        return;
      }
      if (itemId === TRANSLATE_ACTION_ID) {
        void askPageToTranslate(tab.id, info.frameId, hint).catch((error: unknown) => {
          console.error('[SafeTyper] Could not translate the selection:', error);
        });
      }
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.translateTargetLanguage) return;
      const next = changes.translateTargetLanguage.newValue;
      if (typeof next !== 'string' || !isLanguageCode(next)) return;
      void browser.contextMenus
        .update(TRANSLATE_ACTION_ID, { title: translateTargetMenuTitle(languageName(next)) })
        .catch((error: unknown) => {
          console.error('[SafeTyper] Could not update the translate menu title:', error);
        });
    });
  }

  void ensureContentScript();
}

function ensureMenu(): Promise<void> {
  menuTask = menuTask.then(createMenus).catch((error: unknown) => {
    console.error('[SafeTyper] Could not create the translate context menu:', error);
  });
  return menuTask;
}

async function createMenus(): Promise<void> {
  await removeMenu(TRANSLATE_PARENT_ID);
  const title = translateTargetMenuTitle(await targetLanguageName());
  await browser.contextMenus.create({
    id: TRANSLATE_PARENT_ID,
    title: TRANSLATE_PARENT_TITLE,
    contexts: ['selection'],
  });
  await browser.contextMenus.create({
    id: TRANSLATE_ACTION_ID,
    parentId: TRANSLATE_PARENT_ID,
    title,
    contexts: ['selection'],
  });
  await browser.contextMenus.create({
    id: TRANSLATE_CHANGE_LANGUAGE_ID,
    parentId: TRANSLATE_PARENT_ID,
    title: CHANGE_LANGUAGE_TITLE,
    contexts: ['selection'],
  });
}

async function removeMenu(id: string): Promise<void> {
  try {
    await browser.contextMenus.remove(id);
  } catch {
    // The item is absent on a fresh install. That is the expected first-run state.
  }
}

async function targetLanguageName(): Promise<string> {
  const stored = await browser.storage.local.get('translateTargetLanguage');
  const code = stored.translateTargetLanguage;
  if (typeof code === 'string' && isLanguageCode(code)) return languageName(code);
  return languageName(defaultTargetFromUiLanguage(browser.i18n.getUILanguage()));
}

async function askPageToTranslate(
  tabId: number,
  frameId: number | undefined,
  hint: string
): Promise<void> {
  const targets = portsFor(tabId, frameId);
  if (targets.length === 0) {
    console.error('[SafeTyper] The page has no selection translator. Reload it and try again.');
    if (hint.trim()) await openTranslateSurface(hint, '');
    return;
  }

  const requestId = ++requestSeq;
  const replies = new Map<TranslatePort, StatusMessage>();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    let pending = targets.length;
    for (const port of targets) {
      const listener = (message: unknown): void => {
        if (!isStatus(message) || message.requestId !== requestId) return;
        port.onMessage.removeListener(listener);
        replies.set(port, message);
        pending -= 1;
        if (pending <= 0) {
          clearTimeout(timer);
          resolve();
        }
      };
      port.onMessage.addListener(listener);
      port.postMessage({ type: 'query-selection', requestId, text: hint });
    }
  });

  const chosen =
    [...replies.entries()].find(([, status]) => status.hasText)?.[0] ??
    targets.find((port) => port.sender?.frameId === 0) ??
    targets[0];
  chosen?.postMessage({ type: 'show-translation', requestId, text: hint });
}

async function openChangeLanguage(
  tabId: number,
  frameId: number | undefined,
  hint: string
): Promise<void> {
  const targets = portsFor(tabId, frameId);
  const requestId = ++requestSeq;
  let text = hint;
  if (targets.length > 0) {
    text = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(hint), 500);
      const port = targets[0];
      if (!port) {
        clearTimeout(timer);
        resolve(hint);
        return;
      }
      const listener = (message: unknown): void => {
        if (!isStatus(message) || message.requestId !== requestId) return;
        port.onMessage.removeListener(listener);
        clearTimeout(timer);
        resolve(message.hasText && message.text.trim() ? message.text : hint);
      };
      port.onMessage.addListener(listener);
      port.postMessage({ type: 'query-selection', requestId, text: hint });
    });
  }
  await openTranslateSurface(text, '');
}

async function openTranslateSurface(text: string, translation: string): Promise<void> {
  const at = Date.now();
  const handoff: TranslateHandoff = {
    text,
    at,
    translation,
    detected: '',
  };
  if (!isTranslateHandoff(handoff)) return;
  await browser.storage.local.set({
    popupTab: 'translate',
    translateDraftEpoch: at,
    translateSelectionHandoff: handoff,
    translateDraft: text,
    translateResult: translation,
    translateDetectedLanguage: '',
    translateAlternatives: [],
  });
  await openExtensionPopup();
}

async function openSettingsSurface(): Promise<void> {
  await browser.storage.local.set({ popupTab: 'settings' });
  await openExtensionPopup();
}

async function openExtensionPopup(): Promise<void> {
  try {
    await browser.action.openPopup();
    return;
  } catch (error) {
    console.error('[SafeTyper] Toolbar popup did not open, opening a tab instead:', error);
  }
  await browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
}

async function ensureContentScript(): Promise<void> {
  const scriptId = 'safetyper-selection-translate';
  try {
    const scripts = await browser.scripting.getRegisteredContentScripts();
    const existing = scripts.find((script) =>
      (script.js ?? []).some((file) => file.includes('selection-translate'))
    );
    const excludes = [...CONTENT_SCRIPT_EXCLUDE_MATCHES];
    const current =
      existing?.allFrames === true &&
      (existing.css ?? []).length === 0 &&
      sameMatchList(existing.excludeMatches, excludes);
    if (current) return;
    if (existing?.id) {
      await browser.scripting.unregisterContentScripts({ ids: [existing.id] });
    }
    await browser.scripting.registerContentScripts([
      {
        id: existing?.id ?? scriptId,
        matches: ['<all_urls>'],
        excludeMatches: excludes,
        js: ['content-scripts/selection-translate.js'],
        runAt: 'document_idle',
        allFrames: true,
      },
    ]);
  } catch (error) {
    console.error(
      '[SafeTyper] Selection translate script was not registered programmatically:',
      error
    );
  }
}

function portsFor(tabId: number, frameId: number | undefined): TranslatePort[] {
  return [...ports].filter((port) => {
    if (port.sender?.tab?.id !== tabId) return false;
    if (frameId !== undefined && port.sender.frameId !== frameId) return false;
    return true;
  });
}

function readAction(message: unknown): string {
  const record = asRecord(message);
  return typeof record.action === 'string' ? record.action : '';
}

function asRecord(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object') return {};
  return message as Record<string, unknown>;
}

function isStatus(message: unknown): message is StatusMessage {
  if (!message || typeof message !== 'object') return false;
  const record = message as Record<string, unknown>;
  return (
    record.type === 'selection-status' &&
    typeof record.requestId === 'number' &&
    typeof record.hasText === 'boolean' &&
    typeof record.text === 'string'
  );
}
