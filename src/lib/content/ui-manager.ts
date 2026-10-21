/**
 * UI Manager for SafeTyper content script
 * Handles icon, popup creation and interaction
 */

import { browser } from 'wxt/browser';
import { stateManager } from './state-manager';
import { checkGrammar, GrammarCheckCancelled, rewritePassage } from './api-client';
import { OLLAMA_LOADING_HINT_MS } from '../ai/timeout';
import { cancelAutoCheck, getAutoCheckSnapshot, refreshAutoCheckIssues } from './auto-check-state';
import { dismissalsFor, rememberDismissal, withoutDismissed } from './dismissals';
import { placePopupNearRect } from './popup-position';
import { suggestionClientRect } from './underlines';
import { applyGroupColorVariables } from './category-colors';
import { groupFill, highestPriorityGroup } from './group-colors';
import { getIconSizeSetting, iconIsHidden, setIconSizeSetting } from './icon-metrics';
import popupCss from '../../styles/popup-widget.css?inline';
import {
  countByGroup,
  groupColorStyle,
  groupLabel,
  SUGGESTION_GROUPS,
  type SuggestionGroupId,
} from '../categories';
import { REWRITE_OPTIONS, type RewriteOption } from '../rewrite';
import {
  addDictionaryWord,
  dictionaryWordFromQuote,
  indexAfterRemoval,
  nextCardIndex,
  PERSONAL_DICTIONARY_KEY,
  readDictionary,
  removeSuggestionsForWord,
} from './preferences';
import {
  applySuggestion,
  applySuggestions,
  removeSuggestion,
  type Suggestion,
} from './suggestions';
import { iconPositionMoved } from './icon-placement';
import {
  calculateIconPosition,
  calculatePopupPosition,
  getTextContent,
  setTextContent,
  isComplexEditor,
} from './dom-utils';

// Track document-level listeners for cleanup
let activeDragEnd: (() => void) | null = null;
let activeDragMove: ((e: MouseEvent) => void) | null = null;
let activeKeyDown: ((e: KeyboardEvent) => void) | null = null;
let anchorFollow: (() => void) | null = null;
let popupAnchorMode: 'icon' | 'text' = 'icon';
let popupAnchorIssue: Suggestion | null = null;
let checkGeneration = 0;
let manualRequestId: string | null = null;
let loadingHint = 0;
let suggestionCloseTimer = 0;
let popupDragged = false;
let activeSession: SuggestionSession | null = null;

function popupContent(popup: HTMLElement | null): HTMLElement | null {
  return popup?.shadowRoot?.querySelector('.safetyper-popup-content') ?? null;
}

function popupRoot(popup: HTMLElement | null): HTMLElement | null {
  return popup?.shadowRoot?.querySelector('.st-root') ?? null;
}

// Theme state
let currentTheme: 'light' | 'dark' = 'light';

/**
 * Load theme preference from storage
 */
export async function loadTheme(): Promise<void> {
  try {
    const result = await browser.storage.local.get(['darkMode']);
    currentTheme = result.darkMode ? 'dark' : 'light';
  } catch {
    currentTheme = 'light';
  }
  applyGroupColorVariables(currentTheme);
}

/**
 * Update theme on existing UI elements
 */
function paintPopup(popup: HTMLElement | null): void {
  if (!popup) return;
  popup.setAttribute('data-theme', currentTheme);
  const root = popupRoot(popup);
  if (!root) return;
  root.setAttribute('data-theme', currentTheme);
  for (const [name, value] of Object.entries(groupColorStyle(currentTheme))) {
    root.style.setProperty(name, value);
  }
}

export function updateTheme(isDark: boolean): void {
  currentTheme = isDark ? 'dark' : 'light';
  applyGroupColorVariables(currentTheme);
  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    iconContainer.setAttribute('data-theme', currentTheme);
  }
  paintPopup(stateManager.getPopup());
}

function applyIconChrome(host: HTMLElement): void {
  const size = getIconSizeSetting();
  host.setAttribute('data-size', size);
}

/**
 * Open suggestion cards for the focused field. Used when the icon is hidden.
 */
export function openSuggestionsShortcut(): void {
  const field = stateManager.getActiveInput();
  const snap = getAutoCheckSnapshot();
  if (
    field &&
    snap.field === field &&
    snap.issues.length > 0 &&
    snap.text === getTextContent(field)
  ) {
    showFieldIssues(snap.issues);
    return;
  }
  const opener = stateManager.getIconContainer();
  if (!opener) createIcon();
  showPopup(new Event('shortcut'));
}

export function applyIconSize(value: unknown): void {
  setIconSizeSetting(value);
  const icon = stateManager.getIconContainer();
  if (!icon) return;
  applyIconChrome(icon);
  if (iconIsHidden()) {
    hideIcon();
    return;
  }
  const field = stateManager.getActiveInput();
  if (!field) return;
  icon.style.display = 'flex';
  positionIcon(field);
}

const GALLERY_STATES: Array<{
  label: string;
  count: number;
  group: 'correctness' | 'clarity' | 'engagement' | 'delivery' | null;
  typing?: boolean;
  small?: boolean;
}> = [
  { label: 'Idle', count: 0, group: null },
  { label: 'Typing', count: 0, group: null, typing: true },
  { label: 'Correctness', count: 2, group: 'correctness' },
  { label: 'Clarity', count: 2, group: 'clarity' },
  { label: 'Engagement', count: 1, group: 'engagement' },
  { label: 'Delivery', count: 1, group: 'delivery' },
  { label: 'Small', count: 0, group: null, small: true },
  { label: 'Medium', count: 0, group: null },
];

function paintPreview(
  host: HTMLElement,
  item: (typeof GALLERY_STATES)[number],
  theme: 'light' | 'dark'
): void {
  host.className = 'safetyper-icon-preview';
  host.setAttribute('data-theme', theme);
  host.setAttribute('data-size', item.small ? 'small' : 'medium');
  if (item.typing) host.setAttribute('data-typing', 'true');
  if (item.count > 0) host.setAttribute('data-results', 'true');
  const img = document.createElement('img');
  img.src = browser.runtime.getURL('/icon/32.png');
  img.alt = '';
  img.width = 20;
  img.height = 20;
  img.style.imageRendering = 'pixelated';
  host.append(img);
  if (item.count > 0) {
    const badge = document.createElement('span');
    badge.className = 'safetyper-badge is-visible';
    badge.textContent = String(item.count);
    if (item.group) badge.style.background = groupFill(item.group, 'light');
    host.append(badge);
  }
}

function paintGallery(root: HTMLElement, theme: 'light' | 'dark'): void {
  root.replaceChildren();
  for (const item of GALLERY_STATES) {
    const figure = document.createElement('figure');
    figure.className = 'icon-state';
    const host = document.createElement('div');
    paintPreview(host, item, theme);
    const caption = document.createElement('figcaption');
    caption.textContent = item.label;
    figure.append(host, caption);
    root.append(figure);
  }
}

/** Static states on the extension test page. No effect on other sites. */
export function mountIconStateGallery(): void {
  const light = document.getElementById('icon-state-gallery');
  const dark = document.getElementById('icon-state-gallery-dark');
  if (light) paintGallery(light, 'light');
  if (dark) paintGallery(dark, 'dark');
}

export async function loadIconPreferences(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(['iconSize']);
    setIconSizeSetting(stored.iconSize);
  } catch {
    setIconSizeSetting('medium');
  }
  const icon = stateManager.getIconContainer();
  if (icon) {
    applyIconChrome(icon);
    if (iconIsHidden()) hideIcon();
  }
}

/**
 * Create floating icon element
 */
export function createIcon(): HTMLDivElement {
  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] Creating icon...');
  }

  const iconContainer = document.createElement('div');
  iconContainer.className = 'safetyper-icon';
  iconContainer.setAttribute('role', 'button');
  iconContainer.setAttribute('aria-label', 'Check grammar');
  iconContainer.setAttribute('tabindex', '0');
  iconContainer.setAttribute('data-theme', currentTheme);
  applyIconChrome(iconContainer);
  const iconImg = document.createElement('img');
  iconImg.src = browser.runtime.getURL('/icon/32.png');
  iconImg.alt = '';
  iconImg.width = 20;
  iconImg.height = 20;
  iconImg.style.imageRendering = 'pixelated';
  iconContainer.appendChild(iconImg);
  const badge = document.createElement('span');
  badge.className = 'safetyper-badge';
  badge.setAttribute('aria-hidden', 'true');
  iconContainer.appendChild(badge);

  iconContainer.style.left = '0';
  iconContainer.style.top = '0';
  // preventDefault keeps the click from moving the caret or blurring the field.
  iconContainer.addEventListener('mousedown', (event) => event.preventDefault());
  iconContainer.addEventListener('click', showPopup);
  iconContainer.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showPopup(event);
    }
  });

  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] Icon element created:', iconContainer);
    console.log('[SafeTyper UI] document.body exists?', !!document.body);
  }

  document.body.appendChild(iconContainer);

  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] Icon appended to body');
    console.log('[SafeTyper UI] Icon in DOM?', document.body.contains(iconContainer));
    console.log('[SafeTyper UI] Icon computed styles:', window.getComputedStyle(iconContainer));
  }

  stateManager.setIconContainer(iconContainer);

  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] ✅ Icon created successfully');
  }

  return iconContainer;
}

/**
 * Show how many current suggestions the focused field has.
 * A zero count hides the badge. Pass the issues when the group color matters.
 */
export function setIssueCount(
  count: number,
  issues: Array<{ group?: unknown; category?: unknown }> = []
): void {
  const iconContainer = stateManager.getIconContainer();
  if (!iconContainer) return;
  const badge = iconContainer.querySelector('.safetyper-badge');
  if (!(badge instanceof HTMLElement)) return;
  if (count <= 0) {
    badge.classList.remove('is-visible');
    badge.textContent = '';
    badge.style.background = '';
    iconContainer.removeAttribute('data-results');
    iconContainer.setAttribute('aria-label', 'Check grammar');
    return;
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.classList.add('is-visible');
  const group = highestPriorityGroup(issues);
  badge.style.background = group ? groupFill(group, 'light') : '';
  iconContainer.setAttribute('data-results', 'true');
  iconContainer.setAttribute(
    'aria-label',
    `Check grammar, ${count} suggestion${count === 1 ? '' : 's'}`
  );
}

/**
 * One animation frame for every scroll, resize, and observer notification.
 * Painting reads the field box only. It does not read or restore the selection.
 */
let watchedField: HTMLElement | null = null;
let stopWatchingField: (() => void) | null = null;
let iconFrame = 0;
let viewportListening = false;
let fieldVisible = true;

function paintIconPosition(): void {
  const field = watchedField;
  const iconContainer = stateManager.getIconContainer();
  if (!field || !field.isConnected || !iconContainer || iconIsHidden()) return;
  if (iconContainer.style.display === 'none' || !fieldVisible) return;

  const position = calculateIconPosition(field);
  if (!iconPositionMoved(stateManager.getCachedPosition(), position)) return;
  iconContainer.style.transform = `translate(${position.left}px, ${position.top}px)`;
  stateManager.setCachedPosition(position);
}

export function scheduleIconPosition(): void {
  if (!watchedField || iconIsHidden()) return;
  if (iconFrame) return;
  iconFrame = window.requestAnimationFrame(() => {
    iconFrame = 0;
    paintIconPosition();
  });
}

function ensureViewportListeners(): void {
  if (viewportListening) return;
  viewportListening = true;
  window.addEventListener('resize', scheduleIconPosition);
  window.addEventListener('scroll', scheduleIconPosition, true);
}

function watchField(element: HTMLElement): void {
  if (watchedField === element) {
    scheduleIconPosition();
    return;
  }
  stopWatchingField?.();
  watchedField = element;
  fieldVisible = true;
  stateManager.setCachedPosition(null);
  ensureViewportListeners();

  const resizeObserver = new ResizeObserver(() => scheduleIconPosition());
  resizeObserver.observe(element);
  const intersectionObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          const visible = entries.some((entry) => entry.isIntersecting);
          const icon = stateManager.getIconContainer();
          if (visible !== fieldVisible) {
            fieldVisible = visible;
            if (icon && !iconIsHidden()) icon.style.visibility = visible ? 'visible' : 'hidden';
          }
          scheduleIconPosition();
        });
  intersectionObserver?.observe(element);

  stopWatchingField = () => {
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    if (iconFrame) {
      window.cancelAnimationFrame(iconFrame);
      iconFrame = 0;
    }
    watchedField = null;
    stopWatchingField = null;
  };
  scheduleIconPosition();
}

export function positionIcon(element: HTMLElement): void {
  if (iconIsHidden()) {
    hideIcon();
    return;
  }
  const iconContainer = stateManager.getIconContainer();
  if (!iconContainer) {
    if (import.meta.env.DEV) {
      console.warn('[SafeTyper UI] positionIcon called but no icon container exists');
    }
    return;
  }

  if (iconContainer.style.display !== 'flex') iconContainer.style.display = 'flex';
  iconContainer.style.visibility = 'visible';
  watchField(element);
}

/**
 * Hide icon
 */
export function hideIcon(): void {
  stopWatchingField?.();
  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    iconContainer.style.display = 'none';
  }
}

/**
 * Selection changes keep the icon on the field corner.
 * The range is not measured, so the user's selection stays as they left it.
 */
export function positionIconAtSelection(_range: Range): void {
  const field = stateManager.getSelectionAnchorElement() ?? stateManager.getActiveInput();
  if (!field) return;
  positionIcon(field);
}

function sessionForField(
  anchor: HTMLElement,
  text: string,
  suggestions: Suggestion[]
): SuggestionSession {
  const complex = isComplexEditor(anchor);
  return {
    workingText: text,
    suggestions,
    canApply: !complex,
    isComplex: complex,
    anchor,
    prefix: '',
    suffix: '',
    range: null,
    insertedNode: null,
    initialEmpty: suggestions.length === 0,
    filter: 'all',
    rewrite: null,
    rewriteError: '',
    rewriteBusy: false,
    notice: '',
    emptyLabel: 'Nothing to change',
  };
}

function mountPopupShell(): HTMLDivElement {
  popupDragged = false;
  const popup = document.createElement('div');
  popup.className = 'safetyper-popup-host';
  popup.setAttribute('data-theme', currentTheme);
  const shadow = popup.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = popupCss;
  const root = document.createElement('div');
  root.className = 'st-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'SafeTyper suggestions');
  root.setAttribute('data-theme', currentTheme);
  root.innerHTML = `
      <div class="st-header" title="Drag to move">
      <div class="st-header-row">
      <img class="st-logo" alt="" src="${browser.runtime.getURL('/icon/32.png')}" />
      <div class="st-heading"><strong>SafeTyper</strong><span class="st-count" aria-live="polite"></span></div>
      <button type="button" class="st-accept-all" hidden>Accept all</button>
      <div class="st-rewrite-wrap">
        <button type="button" class="st-rewrite" hidden aria-haspopup="menu" aria-expanded="false" aria-controls="st-rewrite-menu">Rewrite</button>
        <div id="st-rewrite-menu" class="st-menu" role="menu" hidden></div>
      </div>
      <button type="button" class="st-close" aria-label="Close">×</button>
      </div>
      <div class="st-filters" role="group" aria-label="Filter by suggestion type" hidden></div>
    </div>
    <div class="safetyper-popup-content">
      <p class="st-loading">Checking...</p>
    </div>
  `;
  shadow.append(style, root);
  paintPopup(popup);
  root.querySelector('.st-close')?.addEventListener('click', closePopup);
  anchorFollow = () => {
    const open = stateManager.getPopup();
    if (!open || popupDragged || popupAnchorMode !== 'text') return;
    repositionPopup(open);
  };
  window.addEventListener('scroll', anchorFollow, true);
  window.addEventListener('resize', anchorFollow);
  root.querySelector('.st-rewrite')?.addEventListener('click', () => {
    toggleRewriteMenu();
  });
  const rewriteMenu = root.querySelector('.st-menu');
  for (const option of REWRITE_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'st-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = option.label;
    item.addEventListener('click', () => {
      closeRewriteMenu();
      const content = popupContent(stateManager.getPopup());
      if (!content || !activeSession || activeSession.rewriteBusy) return;
      void runRewrite(content, activeSession, option);
    });
    rewriteMenu?.append(item);
  }
  activeKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const menu = popupRoot(stateManager.getPopup())?.querySelector('.st-menu');
    if (menu && !menu.hasAttribute('hidden')) {
      event.preventDefault();
      closeRewriteMenu();
      return;
    }
    event.preventDefault();
    closePopup();
  };
  document.addEventListener('keydown', activeKeyDown);
  root.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    const cards = [...root.querySelectorAll<HTMLElement>('.st-list .st-card')];
    if (cards.length === 0) return;
    const current = target instanceof Element ? target.closest<HTMLElement>('.st-card') : null;
    const index = current ? cards.indexOf(current) : -1;
    const next = nextCardIndex(index, event.key === 'ArrowDown' ? 1 : -1, cards.length);
    const button = cards[next]?.querySelector<HTMLButtonElement>('.st-btn-primary, button');
    if (!button || button === target) return;
    event.preventDefault();
    focusControl(button, true);
  });

  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    const iconRect = iconContainer.getBoundingClientRect();
    const activeField = stateManager.getActiveInput();
    const position = placeBesideField(iconRect, activeField?.getBoundingClientRect() ?? null);
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
  }

  document.body.appendChild(popup);
  stateManager.setPopup(popup);
  makePopupDraggable(popup);
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 0);
  return popup;
}

/**
 * Open the suggestion cards for issues already found in the focused field.
 */
export function showFieldIssues(issues: Suggestion[], focusId?: string): void {
  const anchor = stateManager.getActiveInput();
  if (!anchor || issues.length === 0) return;
  const text = getTextContent(anchor);
  const focused = focusId ? issues.filter((issue) => issue.id === focusId) : [];
  const source = focused.length > 0 ? focused : issues;
  const shown = withoutDismissed(text, source, dismissalsFor(anchor));
  const popup = stateManager.getPopup() ?? mountPopupShell();
  const content = popupContent(popup);
  if (!content) return;
  const session = sessionForField(anchor, text, shown);
  if (shown.length === 0) {
    session.initialEmpty = true;
    session.emptyLabel = 'Nothing left to review.';
  }
  choosePopupAnchor(shown, focusId);
  renderSuggestionCards(content, session, shown.length === 0 ? -1 : 0);
  setTimeout(() => repositionPopup(popup), 0);
}

/**
 * Show grammar check popup
 */
export function showPopup(e: Event): void {
  e.stopPropagation();

  if (stateManager.getPopup()) {
    closePopup();
    return;
  }

  const popup = mountPopupShell();
  popupAnchorMode = 'icon';
  popupAnchorIssue = null;
  const field = stateManager.getActiveInput();
  const snap = getAutoCheckSnapshot();
  if (
    stateManager.getInteractionMode() !== 'selection' &&
    field &&
    snap.field === field &&
    snap.issues.length > 0 &&
    snap.text === getTextContent(field)
  ) {
    const content = popupContent(popup);
    if (content) {
      const session = sessionForField(field, snap.text, snap.issues);
      choosePopupAnchor(snap.issues);
      renderSuggestionCards(content, session);
      setTimeout(() => repositionPopup(popup), 0);
    }
    return;
  }

  // Check if API key exists for the active provider
  browser.storage.local
    .get(['selectedProvider', 'openRouterKey', 'groqKey', 'darkMode'])
    .then((result) => {
      if (stateManager.getPopup() !== popup) return;
      // Refresh theme from storage to avoid stale cached value
      const freshTheme = result.darkMode ? 'dark' : 'light';
      if (freshTheme !== currentTheme) {
        currentTheme = freshTheme;
        paintPopup(popup);
        const iconContainer = stateManager.getIconContainer();
        if (iconContainer) {
          iconContainer.setAttribute('data-theme', currentTheme);
        }
      }

      const provider = result.selectedProvider || 'openrouter';
      const hasApiKey =
        provider === 'ollama'
          ? true
          : provider === 'openrouter'
            ? !!result.openRouterKey
            : !!result.groqKey;

      if (popup) {
        const content = popupContent(popup);
        if (content) {
          if (hasApiKey) {
            content.innerHTML = `
            <p class="st-explanation">Check this text for grammar and spelling.</p>
            <div class="st-actions">
              <button type="button" class="st-btn st-btn-primary st-check">Check grammar</button>
              <button type="button" class="st-btn st-settings">Settings</button>
            </div>
          `;

            const checkBtn = content.querySelector('.st-check');
            if (checkBtn) {
              checkBtn.addEventListener('click', handleGrammarCheck);
            }
          } else {
            content.innerHTML = `
            <p class="st-error">Add an API key in Settings to get started.</p>
            <button type="button" class="st-btn st-settings">Open settings</button>
          `;
          }

          const settingsBtn = content.querySelector('.st-settings');
          if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettings);
          }
        }
      }
    });
}

/**
 * Handle click outside popup
 */
function handleOutsideClick(e: MouseEvent): void {
  const popup = stateManager.getPopup();
  // Don't close if loading or clicking close button
  if (popup && popup.dataset.busy !== '1' && !e.composedPath().includes(popup)) {
    closePopup();
  }
}

/**
 * Make popup draggable
 */
function makePopupDraggable(popupElement: HTMLDivElement): void {
  let isDragging = false;
  let initialX: number;
  let initialY: number;
  let initialLeft: number;
  let initialTop: number;

  function dragStart(e: MouseEvent) {
    const target = e.composedPath()[0];
    if (!(target instanceof Element) || !target.closest('.st-header')) return;
    if (target.closest('button, a, input, textarea')) return;

    isDragging = true;
    popupDragged = true;
    initialX = e.clientX;
    initialY = e.clientY;
    initialLeft = parseInt(popupElement.style.left) || 0;
    initialTop = parseInt(popupElement.style.top) || 0;
    popupElement.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function dragEnd() {
    isDragging = false;
    popupElement.style.cursor = 'default';
  }

  function drag(e: MouseEvent) {
    if (!isDragging) return;

    e.preventDefault();
    const currentX = e.clientX - initialX;
    const currentY = e.clientY - initialY;
    let newLeft = initialLeft + currentX;
    let newTop = initialTop + currentY;

    // Constrain to viewport
    const popupRect = popupElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (newLeft < 0) newLeft = 0;
    if (newLeft + popupRect.width > viewportWidth) newLeft = viewportWidth - popupRect.width;
    if (newTop < 0) newTop = 0;
    if (newTop + popupRect.height > viewportHeight) newTop = viewportHeight - popupRect.height;

    popupElement.style.left = `${newLeft}px`;
    popupElement.style.top = `${newTop}px`;
  }

  popupElement.addEventListener('mousedown', dragStart);
  // Keep the field focused so a selection is still there when Accept runs.
  popupElement.addEventListener('mousedown', (e) => {
    const target = e.composedPath()[0];
    if (target instanceof Element && target.closest('button')) {
      e.preventDefault();
    }
  });
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('mousemove', drag);

  // Store references for cleanup
  activeDragEnd = dragEnd;
  activeDragMove = drag;
}

/**
 * Open settings
 */
function openSettings(): void {
  closePopup();
  browser.runtime.sendMessage({ action: 'openPopup' });
}

/**
 * Close popup and clean up all associated listeners
 */
export function closePopup(): void {
  cancelManualCheck();
  activeSession = null;
  popupAnchorMode = 'icon';
  popupAnchorIssue = null;
  window.clearTimeout(loadingHint);
  if (anchorFollow) {
    window.removeEventListener('scroll', anchorFollow, true);
    window.removeEventListener('resize', anchorFollow);
    anchorFollow = null;
  }
  const popup = stateManager.getPopup();
  if (popup) {
    window.clearTimeout(suggestionCloseTimer);
    popup.remove();
    stateManager.setPopup(null);
    document.removeEventListener('click', handleOutsideClick);

    // Clean up drag listeners
    if (activeDragEnd) {
      document.removeEventListener('mouseup', activeDragEnd);
      activeDragEnd = null;
    }
    if (activeDragMove) {
      document.removeEventListener('mousemove', activeDragMove);
      activeDragMove = null;
    }
    if (activeKeyDown) {
      document.removeEventListener('keydown', activeKeyDown);
      activeKeyDown = null;
    }
  }
}

/**
 * Ensure popup stays within viewport bounds
 */
function constrainPopupToViewport(popup: HTMLElement): void {
  const rect = popup.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = parseInt(popup.style.left) || 0;
  let top = parseInt(popup.style.top) || 0;

  // Adjust horizontal position
  if (rect.right > viewportWidth) {
    left = viewportWidth - rect.width - 10;
  }
  if (left < 0) {
    left = 10;
  }

  // Adjust vertical position
  if (rect.bottom > viewportHeight) {
    top = viewportHeight - rect.height - 10;
  }
  if (top < 0) {
    top = 10;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function choosePopupAnchor(issues: readonly Suggestion[], focusId?: string): void {
  const focused = focusId ? issues.find((issue) => issue.id === focusId) : undefined;
  if (focused) {
    popupAnchorMode = 'text';
    popupAnchorIssue = focused;
    return;
  }
  if (issues.length === 1) {
    popupAnchorMode = 'text';
    popupAnchorIssue = issues[0];
    return;
  }
  popupAnchorMode = 'icon';
  popupAnchorIssue = null;
}

function quoteAnchorRect(): DOMRect | null {
  if (popupAnchorMode !== 'text' || !popupAnchorIssue) return null;
  const field = stateManager.getActiveInput() ?? stateManager.getSelectionAnchorElement();
  if (!field) return null;
  const text = activeSession?.workingText || getTextContent(field);
  return suggestionClientRect(field, text, popupAnchorIssue);
}

/**
 * Side-of-field placement is only the fallback. A quote rect anchors the card instead.
 */
function placeBesideField(
  iconRect: DOMRect,
  fieldRect: DOMRect | null,
  width = 360,
  height = 220
): { left: number; top: number } {
  const field = fieldRect ?? iconRect;
  const candidates = [
    { left: field.right + 8, top: field.top },
    { left: field.left, top: field.bottom + 8 },
    { left: Math.max(8, field.left - width - 8), top: field.top },
    { left: field.left, top: Math.max(8, field.top - height - 8) },
  ];
  const scored = candidates.map((candidate) => {
    const right = candidate.left + width;
    const bottom = candidate.top + height;
    const inView =
      candidate.left >= 4 &&
      candidate.top >= 4 &&
      right <= window.innerWidth - 4 &&
      bottom <= window.innerHeight - 4;
    let overlap = 0;
    if (fieldRect) {
      const overlapX = Math.max(
        0,
        Math.min(right, fieldRect.right) - Math.max(candidate.left, fieldRect.left)
      );
      const overlapY = Math.max(
        0,
        Math.min(bottom, fieldRect.bottom) - Math.max(candidate.top, fieldRect.top)
      );
      overlap = overlapX * overlapY;
    }
    return { candidate, inView, overlap };
  });
  const clear = scored.find((item) => item.inView && item.overlap === 0);
  if (clear) return clear.candidate;
  const best = scored.slice().sort((a, b) => a.overlap - b.overlap)[0];
  return best?.candidate ?? calculatePopupPosition(iconRect, width, height);
}

function repositionPopup(popup: HTMLElement): void {
  if (popupDragged) {
    constrainPopupToViewport(popup);
    return;
  }
  const rect = popup.getBoundingClientRect();
  const quoteRect = quoteAnchorRect();
  if (quoteRect) {
    const placed = placePopupNearRect(
      quoteRect,
      { width: rect.width || 360, height: rect.height || 180 },
      { width: window.innerWidth, height: window.innerHeight }
    );
    popup.style.left = `${placed.left}px`;
    popup.style.top = `${placed.top}px`;
    return;
  }
  const icon = stateManager.getIconContainer();
  const field = stateManager.getActiveInput() ?? stateManager.getSelectionAnchorElement();
  const iconRect = icon?.getBoundingClientRect() ?? field?.getBoundingClientRect();
  if (!iconRect) {
    constrainPopupToViewport(popup);
    return;
  }
  const position = placeBesideField(
    iconRect,
    field?.getBoundingClientRect() ?? null,
    rect.width || 360,
    rect.height || 220
  );
  popup.style.left = `${position.left}px`;
  popup.style.top = `${position.top}px`;
  constrainPopupToViewport(popup);
}

interface RewritePreview {
  label: string;
  text: string;
}

interface SuggestionSession {
  workingText: string;
  suggestions: Suggestion[];
  canApply: boolean;
  isComplex: boolean;
  anchor: HTMLElement | null;
  prefix: string;
  suffix: string;
  range: Range | null;
  insertedNode: Text | null;
  initialEmpty: boolean;
  filter: SuggestionGroupId | 'all';
  rewrite: RewritePreview | null;
  rewriteError: string;
  rewriteBusy: boolean;
  notice: string;
  emptyLabel: string;
}

function cancelManualCheck(): void {
  const requestId = manualRequestId;
  manualRequestId = null;
  checkGeneration += 1;
  window.clearTimeout(loadingHint);
  if (!requestId) return;
  void browser.runtime
    .sendMessage({ action: 'cancelGrammarCheck', requestId })
    .catch((error: unknown) => {
      console.error('[SafeTyper] Failed to cancel a grammar check:', error);
    });
}

async function saveDictionaryWord(word: string): Promise<void> {
  const stored = await browser.storage.local.get([PERSONAL_DICTIONARY_KEY]);
  const next = addDictionaryWord(readDictionary(stored[PERSONAL_DICTIONARY_KEY]), word);
  await browser.storage.local.set({ [PERSONAL_DICTIONARY_KEY]: next });
}

function dictionaryIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const cover = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cover.setAttribute('d', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z');
  const spine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  spine.setAttribute('d', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
  for (const path of [cover, spine]) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(cover, spine);
  return svg;
}

/**
 * Script focus does not draw a ring. Keyboard Tab and arrow keys do,
 * through :focus-visible.
 */
function focusControl(element: HTMLElement, focusVisible: boolean): void {
  const options: FocusOptions & { focusVisible?: boolean } = { focusVisible };
  element.focus(options);
}

function focusSuggestion(content: HTMLElement, index: number): void {
  const cards = [...content.querySelectorAll<HTMLElement>('.st-list .st-card')];
  const card = index >= 0 ? cards[index] : undefined;
  if (!card) {
    const done = content.querySelector<HTMLElement>('.st-done');
    if (done) focusControl(done, false);
    return;
  }
  const button = card.querySelector<HTMLButtonElement>('.st-btn-primary, button');
  if (button) focusControl(button, false);
}

function writeSession(session: SuggestionSession): void {
  if (!session.canApply || !session.anchor) return;
  const anchor = session.anchor;
  if (anchor instanceof HTMLInputElement || anchor instanceof HTMLTextAreaElement) {
    anchor.value = session.prefix + session.workingText + session.suffix;
    anchor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (session.insertedNode?.isConnected) {
    session.insertedNode.textContent = session.workingText;
    anchor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (session.range) {
    session.range.deleteContents();
    const node = document.createTextNode(session.workingText);
    session.range.insertNode(node);
    session.insertedNode = node;
    anchor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  setTextContent(anchor, session.prefix + session.workingText + session.suffix);
  anchor.dispatchEvent(new Event('input', { bubbles: true }));
}

async function copyText(value: string): Promise<boolean> {
  const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showManualCopy(content: HTMLElement, value: string): void {
  content.replaceChildren();
  const note = document.createElement('p');
  note.className = 'st-notice';
  note.textContent = 'Clipboard access was denied. Copy the text below.';
  const area = document.createElement('textarea');
  area.className = 'st-manual';
  area.readOnly = true;
  area.value = value;
  content.append(note, area);
  focusControl(area, false);
  area.select();
}

function visibleSuggestions(session: SuggestionSession): Suggestion[] {
  if (
    session.filter !== 'all' &&
    !session.suggestions.some((item) => item.group === session.filter)
  ) {
    session.filter = 'all';
  }
  if (session.filter === 'all') return session.suggestions;
  return session.suggestions.filter((item) => item.group === session.filter);
}

function closeRewriteMenu(): void {
  const root = popupRoot(stateManager.getPopup());
  const menu = root?.querySelector('.st-menu');
  const toggle = root?.querySelector('.st-rewrite');
  if (menu) menu.setAttribute('hidden', '');
  if (toggle instanceof HTMLButtonElement) toggle.setAttribute('aria-expanded', 'false');
}

function toggleRewriteMenu(): void {
  const root = popupRoot(stateManager.getPopup());
  const menu = root?.querySelector('.st-menu');
  const toggle = root?.querySelector('.st-rewrite');
  if (!(menu instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return;
  if (!menu.hasAttribute('hidden')) {
    closeRewriteMenu();
    return;
  }
  menu.removeAttribute('hidden');
  toggle.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('button');
  if (first instanceof HTMLButtonElement) focusControl(first, toggle.matches(':focus-visible'));
}

function acceptVisible(content: HTMLElement, session: SuggestionSession): void {
  const visible = visibleSuggestions(session);
  if (session.isComplex) {
    const corrected = applySuggestions(session.workingText, visible);
    void copyText(corrected).then((ok) => {
      if (!ok) {
        showManualCopy(content, corrected);
        return;
      }
      const visibleIds = new Set(visible.map((item) => item.id));
      session.suggestions = session.suggestions.filter((item) => !visibleIds.has(item.id));
      session.initialEmpty = false;
      renderSuggestionCards(content, session);
    });
    return;
  }
  const ordered = [...visible].sort((a, b) => b.start - a.start);
  for (const suggestion of ordered) {
    const applied = applySuggestion(session.workingText, suggestion);
    if (!applied.changed) {
      session.suggestions = session.suggestions.filter((item) => item.id !== suggestion.id);
      continue;
    }
    session.workingText = applied.text;
    session.suggestions = removeSuggestion(
      session.suggestions,
      suggestion.id,
      applied.start,
      applied.end,
      applied.delta
    );
  }
  writeSession(session);
  session.initialEmpty = false;
  renderSuggestionCards(content, session);
}

async function runRewrite(
  content: HTMLElement,
  session: SuggestionSession,
  option: RewriteOption
): Promise<void> {
  if (session.rewriteBusy) return;
  session.rewriteBusy = true;
  session.rewriteError = '';
  const popup = stateManager.getPopup();
  if (popup) popup.dataset.busy = '1';
  renderSuggestionCards(content, session);
  try {
    const text = await rewritePassage(session.workingText, option.id);
    if (activeSession !== session) return;
    session.rewrite = { label: option.label, text };
  } catch (error: unknown) {
    if (activeSession !== session) return;
    session.rewriteError = error instanceof Error ? error.message : 'The rewrite failed.';
  } finally {
    if (activeSession === session) {
      session.rewriteBusy = false;
      const current = stateManager.getPopup();
      if (current) current.dataset.busy = '';
      renderSuggestionCards(content, session);
      setTimeout(() => {
        const open = stateManager.getPopup();
        if (open) repositionPopup(open);
      }, 0);
    }
  }
}

function renderFilters(
  container: HTMLElement,
  content: HTMLElement,
  session: SuggestionSession
): void {
  container.replaceChildren();
  const total = session.suggestions.length;
  if (total === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const counts = countByGroup(session.suggestions);

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'st-chip';
  all.dataset.group = 'all';
  all.setAttribute('aria-pressed', session.filter === 'all' ? 'true' : 'false');
  all.textContent = `All ${total}`;
  all.addEventListener('click', () => {
    session.filter = 'all';
    renderSuggestionCards(content, session);
  });
  container.append(all);

  for (const group of SUGGESTION_GROUPS) {
    const count = counts[group.id];
    if (count === 0) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'st-chip';
    chip.dataset.group = group.id;
    const pressed = session.filter === group.id;
    chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    const dot = document.createElement('span');
    dot.className = 'st-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `${count} ${group.label}`;
    chip.append(dot, label);
    chip.addEventListener('click', () => {
      session.filter = pressed ? 'all' : group.id;
      renderSuggestionCards(content, session);
    });
    container.append(chip);
  }
}

function renderSuggestionCards(
  content: HTMLElement,
  session: SuggestionSession,
  focusIndex: number | null = null
): void {
  activeSession = session;
  closeRewriteMenu();
  const popup = stateManager.getPopup();
  const root = popupRoot(popup);
  const count = root?.querySelector('.st-count');
  const acceptAll = root?.querySelector('.st-accept-all');
  const rewriteButton = root?.querySelector('.st-rewrite');
  const filters = root?.querySelector('.st-filters');
  const visible = visibleSuggestions(session);
  const remaining = session.suggestions.length;
  const idle = remaining === 0 && !session.rewrite && !session.rewriteBusy && !session.rewriteError;

  if (count) {
    if (session.rewriteBusy) {
      count.textContent = 'Rewriting…';
    } else if (remaining === 0) {
      count.textContent = session.initialEmpty
        ? session.emptyLabel || 'Nothing to change'
        : session.rewrite
          ? 'Rewrite'
          : 'All done';
    } else if (session.filter === 'all') {
      count.textContent = `${remaining} suggestion${remaining === 1 ? '' : 's'}`;
    } else {
      count.textContent = `${visible.length} of ${remaining}`;
    }
  }
  if (acceptAll instanceof HTMLButtonElement) {
    acceptAll.hidden = visible.length === 0;
    acceptAll.textContent = session.isComplex ? 'Copy all' : 'Accept all';
    acceptAll.setAttribute(
      'aria-label',
      session.filter === 'all'
        ? session.isComplex
          ? 'Copy all corrected text'
          : 'Accept all suggestions'
        : session.isComplex
          ? `Copy ${groupLabel(session.filter)} suggestions`
          : `Accept ${groupLabel(session.filter)} suggestions`
    );
    acceptAll.onclick = () => {
      acceptVisible(content, session);
    };
  }
  if (rewriteButton instanceof HTMLButtonElement) {
    rewriteButton.hidden = idle;
    rewriteButton.disabled = session.rewriteBusy;
  }
  if (filters instanceof HTMLElement) renderFilters(filters, content, session);

  content.replaceChildren();
  if (session.notice) {
    const status = document.createElement('p');
    status.className = 'st-notice';
    status.setAttribute('role', 'status');
    status.textContent = session.notice;
    content.append(status);
  }
  if (session.rewriteBusy) {
    const loading = document.createElement('p');
    loading.className = 'st-loading';
    loading.textContent = 'Rewriting…';
    content.append(loading);
  }
  if (session.rewriteError) {
    const error = document.createElement('p');
    error.className = 'st-error';
    error.textContent = session.rewriteError;
    content.append(error);
  }
  if (session.rewrite) {
    content.append(renderRewriteCard(content, session, session.rewrite));
  }

  if (remaining === 0 && !session.rewrite && !session.rewriteBusy) {
    if (!session.rewriteError) {
      const done = document.createElement('p');
      done.className = 'st-done';
      done.tabIndex = -1;
      done.setAttribute('role', 'status');
      done.textContent = session.initialEmpty
        ? session.emptyLabel || 'Nothing to change'
        : 'All done';
      content.append(done);
      window.clearTimeout(suggestionCloseTimer);
      suggestionCloseTimer = window.setTimeout(closePopup, 1600);
      if (focusIndex !== null) queueMicrotask(() => focusSuggestion(content, -1));
    }
    repositionPopupIfOpen();
    return;
  }

  window.clearTimeout(suggestionCloseTimer);
  if (visible.length === 0) return;
  if (session.isComplex) {
    const note = document.createElement('p');
    note.className = 'st-notice';
    note.textContent = 'This editor cannot be edited directly. Copy a fix and paste it.';
    content.append(note);
  }

  const list = document.createElement('div');
  list.className = 'st-list';
  list.setAttribute('role', 'list');
  visible.forEach((suggestion, cardIndex) => {
    list.append(renderIssueCard(content, session, suggestion, cardIndex));
  });
  content.append(list);
  if (focusIndex !== null) queueMicrotask(() => focusSuggestion(content, focusIndex));
  repositionPopupIfOpen();
}

function repositionPopupIfOpen(): void {
  const popup = stateManager.getPopup();
  if (!popup) return;
  repositionPopup(popup);
}

function renderRewriteCard(
  content: HTMLElement,
  session: SuggestionSession,
  rewrite: RewritePreview
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'st-card st-rewrite-card';
  const category = document.createElement('p');
  category.className = 'st-category';
  const dot = document.createElement('span');
  dot.className = 'st-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.textContent = 'Rewrite';
  category.append(dot, name);
  const kicker = document.createElement('p');
  kicker.className = 'st-kicker';
  kicker.textContent = rewrite.label;
  const body = document.createElement('p');
  body.className = 'st-rewrite-text';
  body.textContent = rewrite.text;
  const actions = document.createElement('div');
  actions.className = 'st-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'st-btn st-btn-primary';
  accept.textContent = session.isComplex ? 'Copy rewrite' : 'Accept';
  accept.addEventListener('click', () => {
    if (session.isComplex) {
      void copyText(rewrite.text).then((ok) => {
        if (!ok) {
          showManualCopy(content, rewrite.text);
          return;
        }
        session.rewrite = null;
        session.initialEmpty = false;
        renderSuggestionCards(content, session);
      });
      return;
    }
    session.workingText = rewrite.text;
    session.suggestions = [];
    session.rewrite = null;
    session.initialEmpty = false;
    writeSession(session);
    renderSuggestionCards(content, session);
  });
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'st-btn';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    session.rewrite = null;
    renderSuggestionCards(content, session);
  });
  actions.append(accept, dismiss);
  card.append(category, kicker, body, actions);
  return card;
}

function renderIssueCard(
  content: HTMLElement,
  session: SuggestionSession,
  suggestion: Suggestion,
  cardIndex: number
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'st-card';
  card.setAttribute('role', 'listitem');
  card.dataset.group = suggestion.group;
  card.dataset.subcategory = suggestion.subcategory;
  card.dataset.category = suggestion.category;
  card.setAttribute(
    'aria-label',
    `${groupLabel(suggestion.group)}: ${suggestion.quote.trim() || 'empty'}`
  );
  const category = document.createElement('p');
  category.className = 'st-category';
  const dot = document.createElement('span');
  dot.className = 'st-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.textContent = groupLabel(suggestion.group);
  category.append(dot, name);
  const quote = document.createElement('p');
  quote.className = 'st-quote';
  const original = suggestion.quote.trim();
  const fixed = suggestion.replacement.trim();
  if (original) {
    const struck = document.createElement('del');
    struck.textContent = original;
    quote.append(struck, document.createTextNode(' '));
  }
  const replacement = document.createElement('strong');
  replacement.textContent = fixed || suggestion.replacement;
  quote.append(replacement);
  const explanation = document.createElement('p');
  explanation.className = 'st-explanation';
  explanation.textContent = suggestion.explanation;
  const actions = document.createElement('div');
  actions.className = 'st-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'st-btn st-btn-primary';
  accept.textContent = session.isComplex ? 'Copy fixed text' : 'Accept';
  accept.setAttribute(
    'aria-label',
    session.isComplex
      ? `Copy fixed text for ${original || 'this suggestion'}`
      : `Accept change from ${original || 'empty'} to ${fixed || 'empty'}`
  );
  accept.addEventListener('click', () => {
    const focusAt = () => indexAfterRemoval(cardIndex, visibleCardCount(session));
    if (session.isComplex) {
      void copyText(suggestion.replacement).then((ok) => {
        if (!ok) {
          showManualCopy(content, suggestion.replacement);
          return;
        }
        session.suggestions = session.suggestions.filter((item) => item.id !== suggestion.id);
        session.initialEmpty = false;
        session.notice = '';
        renderSuggestionCards(content, session, focusAt());
      });
      return;
    }
    const applied = applySuggestion(session.workingText, suggestion);
    if (applied.changed) {
      session.workingText = applied.text;
      writeSession(session);
      session.suggestions = removeSuggestion(
        session.suggestions,
        suggestion.id,
        applied.start,
        applied.end,
        applied.delta
      );
    } else {
      session.suggestions = session.suggestions.filter((item) => item.id !== suggestion.id);
    }
    session.initialEmpty = false;
    session.notice = '';
    renderSuggestionCards(content, session, focusAt());
  });
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'st-btn';
  dismiss.textContent = 'Dismiss';
  dismiss.setAttribute('aria-label', `Dismiss suggestion for ${original || 'this text'}`);
  dismiss.addEventListener('click', () => {
    rememberDismissal(session.anchor, suggestion);
    session.suggestions = session.suggestions.filter(
      (item) =>
        `${item.quote}\u0000${item.replacement}` !==
        `${suggestion.quote}\u0000${suggestion.replacement}`
    );
    session.initialEmpty = false;
    session.notice = '';
    if (popupAnchorIssue?.id === suggestion.id) {
      popupAnchorIssue = session.suggestions[0] ?? null;
      if (!popupAnchorIssue) popupAnchorMode = 'icon';
    }
    if (session.anchor && getAutoCheckSnapshot().field === session.anchor) {
      refreshAutoCheckIssues();
    } else {
      setIssueCount(session.suggestions.length, session.suggestions);
    }
    renderSuggestionCards(
      content,
      session,
      indexAfterRemoval(cardIndex, visibleCardCount(session))
    );
  });
  actions.append(accept, dismiss);
  const dictionaryWord =
    suggestion.category === 'spelling' ? dictionaryWordFromQuote(suggestion.quote) : null;
  if (dictionaryWord) {
    const addWord = document.createElement('button');
    addWord.type = 'button';
    addWord.className = 'st-text-btn st-dictionary';
    addWord.append(dictionaryIcon(), document.createTextNode('Add to dictionary'));
    addWord.setAttribute('aria-label', `Add ${dictionaryWord} to dictionary`);
    addWord.addEventListener('click', () => {
      const word = dictionaryWord;
      void saveDictionaryWord(word).then(
        () => {
          if (!content.isConnected) return;
          session.suggestions = removeSuggestionsForWord(session.suggestions, word);
          session.initialEmpty = false;
          session.notice = `Added "${word}" to your dictionary.`;
          renderSuggestionCards(
            content,
            session,
            indexAfterRemoval(cardIndex, visibleCardCount(session))
          );
        },
        (error: unknown) => {
          console.error('[SafeTyper] Failed to update the dictionary:', error);
          if (!content.isConnected) return;
          session.notice = 'Could not update the dictionary.';
          renderSuggestionCards(content, session, cardIndex);
        }
      );
    });
    actions.append(addWord);
  }
  card.append(category, quote, explanation, actions);
  return card;
}

function visibleCardCount(session: SuggestionSession): number {
  return visibleSuggestions(session).length;
}

/**
 * Handle grammar check button click
 */
async function handleGrammarCheck(): Promise<void> {
  cancelAutoCheck();
  let mode = stateManager.getInteractionMode();
  let text: string;
  let activeInput: HTMLElement | null = null;

  if (mode === 'selection') {
    text = stateManager.getSelectedText() || '';
  } else {
    activeInput = stateManager.getActiveInput();
    if (!activeInput) return;

    // Check if the input/textarea has a text selection — the selectionchange
    // debounce may not have fired yet, so detect selection directly.
    if (activeInput instanceof HTMLInputElement || activeInput instanceof HTMLTextAreaElement) {
      const start = activeInput.selectionStart;
      const end = activeInput.selectionEnd;
      if (start !== null && end !== null && start !== end) {
        text = activeInput.value.substring(start, end);
        // Treat as selection mode for apply-changes logic
        mode = 'selection';
        stateManager.setInteractionMode('selection');
        stateManager.setSelectedText(text);
        stateManager.setSelectionInEditable(true);
        stateManager.setSelectionAnchorElement(activeInput);
        stateManager.setSelectionStartOffset(start);
        stateManager.setSelectionEndOffset(end);
      } else {
        text = getTextContent(activeInput);
      }
    } else {
      text = getTextContent(activeInput);
    }
  }

  if (!text.trim()) {
    const popup = stateManager.getPopup();
    if (popup) {
      const content = popupContent(popup);
      if (content) {
        content.innerHTML = `<p class="st-error">Select some text to check grammar.</p>`;
      }
    }
    return;
  }

  cancelManualCheck();
  const generation = ++checkGeneration;
  const requestId = `manual-${generation}`;
  manualRequestId = requestId;

  const popup = stateManager.getPopup();
  if (popup) {
    const content = popupContent(popup);
    if (content) {
      popup.dataset.busy = '1';
      const count = popupRoot(popup)?.querySelector('.st-count');
      if (count) count.textContent = 'Checking…';
      content.innerHTML = '<p class="st-loading">Checking grammar...</p>';
    }
  }
  void browser.storage.local.get('selectedProvider').then((stored) => {
    if (generation !== checkGeneration || stored.selectedProvider !== 'ollama') return;
    loadingHint = window.setTimeout(() => {
      if (generation !== checkGeneration) return;
      const open = stateManager.getPopup();
      const loading = open ? popupContent(open)?.querySelector('.st-loading') : null;
      if (loading) loading.textContent = 'Loading model…';
    }, OLLAMA_LOADING_HINT_MS);
  });

  try {
    const result = await checkGrammar(text, requestId);
    if (generation !== checkGeneration) return;
    delete stateManager.getPopup()?.dataset.busy;

    const currentPopup = stateManager.getPopup();
    if (!currentPopup) return;
    const content = popupContent(currentPopup);
    if (!content) return;

    let canApply = false;
    let isComplex = false;
    const anchor = mode === 'selection' ? stateManager.getSelectionAnchorElement() : activeInput;
    if (anchor) {
      isComplex = isComplexEditor(anchor);
      canApply = !isComplex;
    }

    let prefix = '';
    let suffix = '';
    let range: Range | null = null;
    if (canApply && anchor && mode === 'selection') {
      if (anchor instanceof HTMLInputElement || anchor instanceof HTMLTextAreaElement) {
        const full = anchor.value;
        const start = stateManager.getSelectionStartOffset() ?? 0;
        const end = stateManager.getSelectionEndOffset() ?? full.length;
        prefix = full.slice(0, start);
        suffix = full.slice(end);
      } else {
        range = stateManager.getSelectedRange()?.cloneRange() ?? null;
      }
    }

    const visible = withoutDismissed(text, result.suggestions, dismissalsFor(anchor));
    const hiddenByDismissal = result.suggestions.length - visible.length;
    setIssueCount(visible.length, visible);
    choosePopupAnchor(visible);
    renderSuggestionCards(
      content,
      {
        workingText: text,
        suggestions: visible,
        canApply,
        isComplex,
        anchor,
        prefix,
        suffix,
        range,
        insertedNode: null,
        initialEmpty: visible.length === 0,
        filter: 'all',
        rewrite: null,
        rewriteError: '',
        rewriteBusy: false,
        notice: '',
        emptyLabel:
          result.hiddenCount > 0 || hiddenByDismissal > 0
            ? 'Nothing left to review.'
            : 'Looks good',
      },
      visible.length === 0 ? -1 : 0
    );
    setTimeout(() => repositionPopup(currentPopup), 0);
  } catch (error: unknown) {
    if (generation !== checkGeneration) return;
    if (error instanceof GrammarCheckCancelled) {
      // A superseded check must not leave the card on "Checking…".
      // A newer check in this page has already replaced the loading state.
      const popup = stateManager.getPopup();
      const loading = popup ? popupContent(popup)?.querySelector('.st-loading') : null;
      const stillThisCheck =
        popup?.dataset.busy === '1' && /check|loading model/i.test(loading?.textContent ?? '');
      if (stillThisCheck) showCheckError('The check was interrupted. Try again.');
      return;
    }
    if (import.meta.env.DEV) {
      console.error('Grammar check error:', error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    showCheckError(message);
  } finally {
    window.clearTimeout(loadingHint);
    if (manualRequestId === requestId) manualRequestId = null;
  }
}

function showCheckError(message: string): void {
  const popup = stateManager.getPopup();
  if (!popup) return;
  const content = popupContent(popup);
  if (!content) return;
  delete popup.dataset.busy;
  const count = popupRoot(popup)?.querySelector('.st-count');
  if (count) count.textContent = 'Could not check';
  content.replaceChildren();
  const error = document.createElement('p');
  error.className = 'st-error';
  error.textContent = message;
  error.style.marginBottom = '10px';
  const actions = document.createElement('div');
  actions.className = 'st-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'st-btn st-btn-primary st-retry';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => {
    void handleGrammarCheck();
  });
  actions.append(retry);
  content.append(error, actions);
  repositionPopup(popup);
}
