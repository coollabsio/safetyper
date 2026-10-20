/**
 * Page-side controller for selection translation.
 * Owns one shadow-root bubble and does not touch the grammar popup.
 */

import { browser } from 'wxt/browser';
import { TranslateError, translateText } from '../translate/client';
import { AUTO_DETECT, defaultTargetFromUiLanguage, isLanguageCode } from '../translate/languages';
import { mountTranslationBubble, type TranslationBubble } from './bubble';
import { OPEN_SETTINGS_ACTION, OPEN_TRANSLATE_TAB_ACTION, SELECTION_TRANSLATE_PORT } from './menu';
import type { AnchorBox } from './position';
import {
  currentRect,
  isTranslateBubbleNode,
  normalizeSelectionText,
  readPageSelection,
  replaceEditableText,
  type EditableTarget,
  type PageSelection,
} from './selection';

interface Session {
  text: string;
  editable: EditableTarget | null;
  rect: AnchorBox;
  requestId: number;
}

interface PortMessage {
  type?: string;
  requestId?: number;
  text?: string;
}

declare global {
  interface Window {
    __safetyperSelectionTranslate?: boolean;
  }
}

let bubble: TranslationBubble | null = null;
let session: Session | null = null;
let lastCapture: PageSelection | null = null;
let requestSeq = 0;
let copiedTimer = 0;
let port: ReturnType<typeof browser.runtime.connect> | null = null;

export function startSelectionTranslate(): void {
  if (window.__safetyperSelectionTranslate) return;
  window.__safetyperSelectionTranslate = true;

  document.addEventListener('contextmenu', rememberSelection, true);
  document.addEventListener('selectionchange', rememberSelection);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', followSelection, true);
  window.addEventListener('resize', followSelection);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !bubble?.isOpen()) return;
    if (changes.darkMode) {
      bubble.setTheme(changes.darkMode.newValue === true ? 'dark' : 'light');
    }
    const nextTarget = changes.translateTargetLanguage?.newValue;
    if (typeof nextTarget === 'string') bubble.setTarget(nextTarget);
  });
  connectPort();
}

function rememberSelection(): void {
  const selection = readPageSelection();
  if (!selection || isTranslateBubbleNode(document.activeElement)) return;
  lastCapture = selection;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !bubble?.isOpen()) return;
  event.preventDefault();
  event.stopPropagation();
  closeBubble();
}

function followSelection(): void {
  if (!bubble?.isOpen() || !session) return;
  bubble.follow(currentRect(sessionAsSelection()));
}

function sessionAsSelection(): PageSelection {
  return {
    text: session?.text ?? '',
    rect: session?.rect ?? { left: 16, top: 16, width: 0, height: 0 },
    editable: session?.editable ?? null,
    at: Date.now(),
  };
}

function connectPort(): void {
  try {
    port = browser.runtime.connect({ name: SELECTION_TRANSLATE_PORT });
  } catch (error) {
    console.error('[SafeTyper] Could not connect the selection translator:', error);
    return;
  }

  port.onMessage.addListener((message: unknown) => {
    void handlePortMessage(message);
  });
  port.onDisconnect.addListener(() => {
    port = null;
    if (!browser.runtime.id) return;
    window.setTimeout(connectPort, 500);
  });
}

async function handlePortMessage(message: unknown): Promise<void> {
  if (!isPortMessage(message) || !port) return;
  if (message.type === 'query-selection' && typeof message.requestId === 'number') {
    const selection = resolveSelection(typeof message.text === 'string' ? message.text : undefined);
    port.postMessage({
      type: 'selection-status',
      requestId: message.requestId,
      hasText: Boolean(selection?.text.trim()),
      text: selection?.text ?? '',
    });
    return;
  }
  if (message.type === 'show-translation') {
    await showTranslation(typeof message.text === 'string' ? message.text : undefined);
  }
}

async function showTranslation(hint?: string): Promise<void> {
  const selection = resolveSelection(hint);
  if (!selection || !selection.text.trim()) {
    await showEmptyState();
    return;
  }
  await runTranslation(selection);
}

async function showEmptyState(): Promise<void> {
  session = null;
  const theme = await readTheme();
  const target = await readTargetLanguage();
  ensureBubble({ left: 24, top: 24, width: 0, height: 0 }, target, theme);
  bubble?.setError('Select some text to translate.', false, false);
}

async function runTranslation(selection: PageSelection): Promise<void> {
  const requestId = ++requestSeq;
  const text = selection.text;
  session = {
    text,
    editable: selection.editable,
    rect: selection.rect,
    requestId,
  };

  const [target, source, theme] = await Promise.all([
    readTargetLanguage(),
    readSourceLanguage(),
    readTheme(),
  ]);
  if (session.requestId !== requestId) return;

  ensureBubble(currentRect(selection), target, theme);
  bubble?.setLoading();

  try {
    const result = await translateText(text, source, target);
    if (session?.requestId !== requestId || !bubble?.isOpen()) return;
    bubble.setResult(
      result.translation,
      result.detectedSourceLanguage ?? '',
      selection.editable !== null
    );
  } catch (error) {
    if (session?.requestId !== requestId || !bubble?.isOpen()) return;
    if (!(error instanceof TranslateError)) {
      console.error('[SafeTyper] Translation failed:', error);
    }
    const message =
      error instanceof TranslateError ? error.message : 'Translation failed. Try again.';
    const opensSettings = error instanceof TranslateError ? error.opensSettings : false;
    bubble.setError(message, opensSettings, true);
  }
}

function ensureBubble(anchor: AnchorBox, target: string, theme: 'light' | 'dark'): void {
  if (bubble?.isOpen()) {
    bubble.setTheme(theme);
    bubble.setTarget(target);
    bubble.follow(anchor);
    return;
  }
  bubble = mountTranslationBubble(anchor, target, theme, {
    onClose: closeBubble,
    onTargetChange: (code) => {
      void changeTarget(code);
    },
    onCopy: () => {
      void copyTranslation();
    },
    onReplace: replaceTranslation,
    onOpenTab: () => {
      void openTranslateTab();
    },
    onOpenSettings: () => {
      void openSettings();
    },
  });
}

async function changeTarget(code: string): Promise<void> {
  if (!isLanguageCode(code)) return;
  try {
    await browser.storage.local.set({ translateTargetLanguage: code });
  } catch (error) {
    console.error('[SafeTyper] Could not save the target language:', error);
  }
  if (!session?.text.trim()) return;
  const selection: PageSelection = {
    text: session.text,
    editable: session.editable,
    rect: session.rect,
    at: Date.now(),
  };
  await runTranslation(selection);
}

async function copyTranslation(): Promise<void> {
  const text = bubble?.translation() ?? '';
  if (!text) return;
  try {
    await writeClipboard(text);
    bubble?.setCopied(true);
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => bubble?.setCopied(false), 1500);
  } catch (error) {
    console.error('[SafeTyper] Could not copy the translation:', error);
    bubble?.setError('Could not copy the translation.', false, Boolean(session?.text));
  }
}

function replaceTranslation(): void {
  const text = bubble?.translation() ?? '';
  if (!text || !session?.editable) return;
  const replaced = replaceEditableText(session.editable, text);
  if (!replaced) {
    bubble?.setError('Could not replace the selection.', false, true);
  }
}

async function openTranslateTab(): Promise<void> {
  if (!session?.text) return;
  try {
    await browser.runtime.sendMessage({
      action: OPEN_TRANSLATE_TAB_ACTION,
      text: session.text,
      translation: bubble?.translation() ?? '',
    });
  } catch (error) {
    console.error('[SafeTyper] Could not open the Translate tab:', error);
  }
}

async function openSettings(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ action: OPEN_SETTINGS_ACTION });
  } catch (error) {
    console.error('[SafeTyper] Could not open Settings:', error);
  }
}

function closeBubble(): void {
  requestSeq += 1;
  bubble?.destroy();
  bubble = null;
  session = null;
}

function resolveSelection(hint?: string): PageSelection | null {
  const live = readPageSelection();
  if (live?.text.trim()) return live;
  if (!hint?.trim()) return null;

  if (
    lastCapture &&
    Date.now() - lastCapture.at < 15_000 &&
    normalizeSelectionText(lastCapture.text) === normalizeSelectionText(hint)
  ) {
    return lastCapture;
  }

  return {
    text: hint,
    rect: { left: 24, top: 24, width: 0, height: 0 },
    editable: null,
    at: Date.now(),
  };
}

async function readTargetLanguage(): Promise<string> {
  const stored = await browser.storage.local.get('translateTargetLanguage');
  const value = stored.translateTargetLanguage;
  if (typeof value === 'string' && isLanguageCode(value)) return value;
  const next = defaultTargetFromUiLanguage(browser.i18n.getUILanguage());
  try {
    await browser.storage.local.set({ translateTargetLanguage: next });
  } catch (error) {
    console.error('[SafeTyper] Could not save the default target language:', error);
  }
  return next;
}

async function readSourceLanguage(): Promise<string> {
  const stored = await browser.storage.local.get('translateSourceLanguage');
  const value = stored.translateSourceLanguage;
  if (value === AUTO_DETECT || (typeof value === 'string' && isLanguageCode(value))) return value;
  return AUTO_DETECT;
}

async function readTheme(): Promise<'light' | 'dark'> {
  const stored = await browser.storage.local.get('darkMode');
  return stored.darkMode === true ? 'dark' : 'light';
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    console.error('[SafeTyper] Clipboard API failed, trying a fallback copy:', error);
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) {
    throw new Error('Copy failed');
  }
}

function isPortMessage(message: unknown): message is PortMessage {
  return !!message && typeof message === 'object' && 'type' in message;
}
