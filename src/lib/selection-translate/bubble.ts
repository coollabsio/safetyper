/**
 * Floating translation bubble. Styles and markup stay inside this shadow root
 * so page CSS, and the grammar popup's shadow root, cannot restyle it.
 */

import { browser } from 'wxt/browser';
import bubbleCss from './bubble.css?inline';
import { LANGUAGES } from '../translate/languages';
import { placeBubble, type AnchorBox } from './position';

export interface BubbleHandlers {
  onClose: () => void;
  onTargetChange: (code: string) => void;
  onCopy: () => void;
  onReplace: () => void;
  onOpenTab: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

export interface TranslationBubble {
  setTheme: (theme: 'light' | 'dark') => void;
  setTarget: (code: string) => void;
  setLoading: (message?: string) => void;
  setResult: (translation: string, detected: string, canReplace: boolean) => void;
  setError: (
    message: string,
    opensSettings: boolean,
    canOpenTab: boolean,
    canRetry?: boolean
  ) => void;
  setCopied: (copied: boolean) => void;
  follow: (anchor: AnchorBox) => void;
  translation: () => string;
  destroy: () => void;
  isOpen: () => boolean;
}

export function mountTranslationBubble(
  anchor: AnchorBox,
  targetCode: string,
  theme: 'light' | 'dark',
  handlers: BubbleHandlers
): TranslationBubble {
  const host = document.createElement('div');
  host.setAttribute('data-safetyper-translate', 'bubble');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483646';
  host.style.display = 'block';
  host.style.width = 'max-content';
  host.style.maxWidth = 'calc(100vw - 16px)';
  host.style.margin = '0';
  host.style.left = '0';
  host.style.top = '0';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = bubbleCss;

  const root = document.createElement('div');
  root.className = 'tr-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'SafeTyper translation');
  root.dataset.theme = theme;
  root.dataset.state = 'loading';

  const header = document.createElement('div');
  header.className = 'tr-header';
  header.title = 'Drag to move';

  const logo = document.createElement('img');
  logo.className = 'tr-logo';
  logo.alt = '';
  logo.src = browser.runtime.getURL('/icon/32.png');

  const heading = document.createElement('div');
  heading.className = 'tr-heading';
  const title = document.createElement('strong');
  title.textContent = 'Translate';
  const detected = document.createElement('span');
  detected.className = 'tr-detected';
  detected.hidden = true;
  heading.append(title, detected);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'tr-close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.textContent = '×';

  header.append(logo, heading, closeButton);

  const languageLabel = document.createElement('label');
  languageLabel.className = 'tr-lang';
  const languageText = document.createElement('span');
  languageText.textContent = 'To';
  const select = document.createElement('select');
  select.className = 'tr-select';
  select.setAttribute('aria-label', 'Target language');
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.name;
    select.append(option);
  }
  select.value = targetCode;
  languageLabel.append(languageText, select);

  const body = document.createElement('div');
  body.className = 'tr-body';
  body.setAttribute('role', 'status');
  body.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'tr-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'tr-btn tr-copy';
  copyButton.textContent = 'Copy';

  const replaceButton = document.createElement('button');
  replaceButton.type = 'button';
  replaceButton.className = 'tr-btn tr-btn-primary tr-replace';
  replaceButton.textContent = 'Replace';
  replaceButton.hidden = true;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'tr-btn tr-open';
  openButton.textContent = 'Open in Translate tab';

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'tr-btn tr-btn-primary tr-retry';
  retryButton.textContent = 'Retry';
  retryButton.hidden = true;

  actions.append(copyButton, replaceButton, openButton, retryButton);

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'tr-settings';
  settingsButton.textContent = 'Open Settings';
  settingsButton.hidden = true;

  root.append(header, languageLabel, body, actions, settingsButton);
  shadow.append(style, root);
  (document.body ?? document.documentElement).append(host);

  let currentAnchor = anchor;
  let movedByUser = false;
  let open = true;
  let translationText = '';
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  root.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('select, input, textarea')) return;
    event.preventDefault();
  });

  closeButton.addEventListener('click', () => handlers.onClose());
  select.addEventListener('change', () => handlers.onTargetChange(select.value));
  copyButton.addEventListener('click', () => handlers.onCopy());
  replaceButton.addEventListener('click', () => handlers.onReplace());
  openButton.addEventListener('click', () => handlers.onOpenTab());
  settingsButton.addEventListener('click', () => handlers.onOpenSettings());
  retryButton.addEventListener('click', () => handlers.onRetry());

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, select, a')) return;
    dragging = true;
    movedByUser = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = host.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    header.setPointerCapture(event.pointerId);
  });

  header.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    moveHost(originLeft + event.clientX - startX, originTop + event.clientY - startY);
  });

  const stopDrag = (): void => {
    dragging = false;
  };
  header.addEventListener('pointerup', stopDrag);
  header.addEventListener('pointercancel', stopDrag);

  function reposition(): void {
    if (!open || movedByUser) return;
    const size = root.getBoundingClientRect();
    const placed = placeBubble(
      currentAnchor,
      { width: size.width || 320, height: size.height || 160 },
      { width: window.innerWidth, height: window.innerHeight }
    );
    host.style.left = `${placed.left}px`;
    host.style.top = `${placed.top}px`;
  }

  function moveHost(left: number, top: number): void {
    const size = root.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - size.width - 8);
    const maxTop = Math.max(8, window.innerHeight - size.height - 8);
    host.style.left = `${Math.min(maxLeft, Math.max(8, left))}px`;
    host.style.top = `${Math.min(maxTop, Math.max(8, top))}px`;
  }

  function setPrimary(canReplace: boolean): void {
    replaceButton.hidden = !canReplace;
    copyButton.classList.toggle('tr-btn-primary', !canReplace);
    replaceButton.classList.toggle('tr-btn-primary', canReplace);
  }

  function fillBody(className: string, text: string): void {
    body.replaceChildren();
    const paragraph = document.createElement('p');
    paragraph.className = className;
    paragraph.textContent = text;
    body.append(paragraph);
  }

  const view: TranslationBubble = {
    setTheme(next) {
      root.dataset.theme = next;
    },
    setTarget(code) {
      if (LANGUAGES.some((language) => language.code === code)) {
        select.value = code;
      }
    },
    setLoading(message = 'Translating…') {
      translationText = '';
      root.dataset.state = 'loading';
      detected.hidden = true;
      detected.textContent = '';
      fillBody('tr-loading', message);
      actions.hidden = true;
      settingsButton.hidden = true;
      retryButton.hidden = true;
      copyButton.disabled = true;
      replaceButton.disabled = true;
      reposition();
    },
    setResult(translation, detectedName, canReplace) {
      translationText = translation;
      root.dataset.state = 'result';
      detected.hidden = detectedName.trim().length === 0;
      detected.textContent = detectedName.trim() ? `Detected ${detectedName.trim()}` : '';
      fillBody('tr-text', translation);
      actions.hidden = false;
      settingsButton.hidden = true;
      copyButton.hidden = false;
      copyButton.disabled = false;
      copyButton.textContent = 'Copy';
      replaceButton.disabled = false;
      openButton.hidden = false;
      setPrimary(canReplace);
      reposition();
    },
    setError(message, opensSettings, canOpenTab, canRetry = false) {
      translationText = '';
      root.dataset.state = 'error';
      detected.hidden = true;
      detected.textContent = '';
      fillBody('tr-error', message);
      retryButton.hidden = !canRetry;
      actions.hidden = !canOpenTab && !canRetry;
      copyButton.hidden = true;
      replaceButton.hidden = true;
      openButton.hidden = !canOpenTab;
      settingsButton.hidden = !opensSettings;
      reposition();
    },
    setCopied(copied) {
      copyButton.textContent = copied ? 'Copied' : 'Copy';
    },
    follow(next) {
      currentAnchor = next;
      reposition();
    },
    translation() {
      return translationText;
    },
    destroy() {
      open = false;
      host.remove();
    },
    isOpen() {
      return open && host.isConnected;
    },
  };

  view.setLoading();
  return view;
}
