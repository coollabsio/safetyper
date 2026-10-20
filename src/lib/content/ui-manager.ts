/**
 * UI Manager for SafeTyper content script
 * Handles icon, popup creation and interaction
 */

import { browser } from 'wxt/browser';
import { stateManager } from './state-manager';
import { checkGrammar } from './api-client';
import { cancelAutoCheck, getAutoCheckSnapshot } from './auto-check-state';
import { backdropLuminance } from './icon-placement';
import { highestPriorityGroup, type SuggestionGroupId } from './group-colors';
import { mountIconFace } from './icon-view';
import { ICON_PIXELS, iconIsHidden, iconPixelSize, setIconSizeSetting } from './icon-metrics';
import { presentIcon, type IconActivity } from './icon-state';
import popupCss from '../../styles/popup-widget.css?inline';
import {
  applySuggestion,
  applySuggestions,
  removeSuggestion,
  type Suggestion,
} from './suggestions';
import {
  calculateIconPosition,
  calculatePopupPosition,
  calculateSelectionIconPosition,
  getTextContent,
  setTextContent,
  isComplexEditor,
  escapeHtml,
} from './dom-utils';

// Track document-level listeners for cleanup
let activeDragEnd: (() => void) | null = null;
let activeDragMove: ((e: MouseEvent) => void) | null = null;
let activeKeyDown: ((e: KeyboardEvent) => void) | null = null;
let suggestionCloseTimer = 0;
let popupDragged = false;

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
}

/**
 * Update theme on existing UI elements
 */
export function updateTheme(isDark: boolean): void {
  currentTheme = isDark ? 'dark' : 'light';
  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    iconContainer.setAttribute('data-theme', currentTheme);
  }
  const popup = stateManager.getPopup();
  if (popup) {
    popup.setAttribute('data-theme', currentTheme);
    popupRoot(popup)?.setAttribute('data-theme', currentTheme);
  }
}

let iconActivity: IconActivity = 'idle';
let iconCount = 0;
let iconGroup: SuggestionGroupId | null = null;
let iconAutoCheck = false;
let iconSurface: 'light' | 'dark' = 'light';
let cleanTimer = 0;
let typingTimer = 0;

function syncIconFace(host: HTMLElement): void {
  const view = presentIcon({
    activity: iconActivity,
    count: iconCount,
    autoCheck: iconAutoCheck,
    group: iconGroup,
  });
  const pixels = iconPixelSize();
  host.setAttribute(
    'data-size',
    iconIsHidden() ? 'hidden' : pixels === ICON_PIXELS.medium ? 'medium' : 'small'
  );
  host.style.width = `${pixels}px`;
  host.style.height = `${pixels}px`;
  mountIconFace(host, {
    activity: view.activity,
    count: view.count,
    countAsIcon: view.countAsIcon,
    group: view.group,
    surface: iconSurface,
    onActivate: showPopup,
  });
}

/**
 * Show the icon unless the user hid it in settings.
 */
export function revealIcon(): HTMLDivElement | null {
  if (iconIsHidden()) {
    hideIcon();
    return null;
  }
  const icon = stateManager.getIconContainer() || createIcon();
  icon.style.display = 'flex';
  return icon;
}

export function noteIconTyping(): void {
  const icon = stateManager.getIconContainer();
  if (!icon || iconIsHidden()) return;
  icon.setAttribute('data-typing', 'true');
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => icon.removeAttribute('data-typing'), 700);
}

export function setIconAutoCheck(enabled: boolean): void {
  iconAutoCheck = enabled;
  const icon = stateManager.getIconContainer();
  if (icon) syncIconFace(icon);
}

export function setIconActivity(
  activity: IconActivity,
  issues: Array<{ group?: unknown; category?: unknown }> = []
): void {
  window.clearTimeout(cleanTimer);
  iconActivity = activity;
  iconCount = activity === 'issues' ? issues.length : 0;
  iconGroup = activity === 'issues' ? highestPriorityGroup(issues) : null;
  const icon = stateManager.getIconContainer();
  if (icon) syncIconFace(icon);
  if (activity === 'clean') {
    cleanTimer = window.setTimeout(() => {
      if (iconActivity !== 'clean') return;
      iconActivity = 'idle';
      const current = stateManager.getIconContainer();
      if (current) syncIconFace(current);
    }, 1600);
  }
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
  syncIconFace(icon);
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
  activity: IconActivity;
  count: number;
  autoCheck: boolean;
  group: SuggestionGroupId | null;
  typing?: boolean;
  reveal?: boolean;
  medium?: boolean;
}> = [
  { label: 'Idle', activity: 'idle', count: 0, autoCheck: false, group: null },
  { label: 'Typing', activity: 'idle', count: 0, autoCheck: false, group: null, typing: true },
  { label: 'Checking', activity: 'checking', count: 0, autoCheck: true, group: null },
  { label: 'Clean', activity: 'clean', count: 0, autoCheck: true, group: null },
  { label: 'Correctness', activity: 'issues', count: 2, autoCheck: false, group: 'correctness' },
  { label: 'Clarity', activity: 'issues', count: 2, autoCheck: false, group: 'clarity' },
  { label: 'Engagement', activity: 'issues', count: 1, autoCheck: false, group: 'engagement' },
  { label: 'Delivery', activity: 'issues', count: 1, autoCheck: false, group: 'delivery' },
  { label: 'Count', activity: 'issues', count: 3, autoCheck: true, group: 'correctness' },
  {
    label: 'Hover',
    activity: 'issues',
    count: 3,
    autoCheck: true,
    group: 'correctness',
    reveal: true,
  },
  { label: 'Small', activity: 'idle', count: 0, autoCheck: false, group: null },
  { label: 'Medium', activity: 'idle', count: 0, autoCheck: false, group: null, medium: true },
];

function paintGallery(root: HTMLElement, surface: 'light' | 'dark'): void {
  root.replaceChildren();
  for (const item of GALLERY_STATES) {
    const figure = document.createElement('figure');
    figure.className = 'icon-state';
    const host = document.createElement('div');
    host.className = 'safetyper-icon-preview';
    if (item.medium) {
      host.setAttribute('data-size', 'medium');
      host.style.width = '28px';
      host.style.height = '28px';
    }
    if (item.typing) host.setAttribute('data-typing', 'true');
    const view = presentIcon({
      activity: item.activity,
      count: item.count,
      autoCheck: item.autoCheck,
      group: item.group,
    });
    mountIconFace(host, {
      activity: view.activity,
      count: view.count,
      countAsIcon: view.countAsIcon,
      group: view.group,
      surface,
    });
    if (item.reveal) host.setAttribute('data-reveal', 'true');
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
    const stored = await browser.storage.local.get(['iconSize', 'autoCheckEnabled']);
    setIconSizeSetting(stored.iconSize);
    iconAutoCheck = stored.autoCheckEnabled === true;
  } catch {
    setIconSizeSetting('small');
  }
  const icon = stateManager.getIconContainer();
  if (icon) {
    syncIconFace(icon);
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
  syncIconFace(iconContainer);
  iconContainer.addEventListener('mousedown', (event) => event.preventDefault());

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
  if (count <= 0) {
    setIconActivity(iconActivity === 'checking' ? 'checking' : 'idle');
    return;
  }
  const sample = issues.length > 0 ? issues : Array.from({ length: count }, () => ({}));
  setIconActivity('issues', sample);
}

/**
 * Position icon near the active input
 */
let watchedField: HTMLElement | null = null;
let stopWatchingField: (() => void) | null = null;

function watchField(element: HTMLElement): void {
  if (watchedField === element) return;
  stopWatchingField?.();
  watchedField = element;

  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (stateManager.getActiveInput() === element) positionIcon(element);
    }, 50);
  };

  const observer = new MutationObserver(schedule);
  const options: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  };
  const parent = element.parentElement;
  if (parent && parent !== document.body && parent !== document.documentElement) {
    observer.observe(parent, options);
  }
  const grand = parent?.parentElement;
  if (
    grand &&
    grand !== document.body &&
    grand !== document.documentElement &&
    grand.childElementCount <= 40
  ) {
    observer.observe(grand, options);
  }

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(element);

  const late = [300, 900].map((delay) => window.setTimeout(schedule, delay));
  stopWatchingField = () => {
    observer.disconnect();
    resizeObserver.disconnect();
    window.clearTimeout(timer);
    late.forEach((id) => window.clearTimeout(id));
    watchedField = null;
    stopWatchingField = null;
  };
}

export function positionIcon(element: HTMLElement): void {
  if (iconIsHidden()) {
    hideIcon();
    return;
  }
  watchField(element);
  const iconContainer = stateManager.getIconContainer();
  if (!iconContainer) {
    if (import.meta.env.DEV) {
      console.warn('[SafeTyper UI] positionIcon called but no icon container exists');
    }
    return;
  }

  const position = calculateIconPosition(element);
  const cachedPosition = stateManager.getCachedPosition();

  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] Positioning icon:', { position, cachedPosition });
  }

  // Only update DOM if position changed
  if (
    !cachedPosition ||
    cachedPosition.left !== position.left ||
    cachedPosition.top !== position.top
  ) {
    iconContainer.style.left = `${position.left}px`;
    iconContainer.style.top = `${position.top}px`;
    stateManager.setCachedPosition(position);

    if (import.meta.env.DEV) {
      console.log('[SafeTyper UI] Icon position updated:', position);
    }
  }

  const luminance = backdropLuminance(position);
  const surface = luminance !== null && luminance <= 0.45 ? 'dark' : 'light';
  if (surface !== iconSurface) {
    iconSurface = surface;
    syncIconFace(iconContainer);
  }
  iconContainer.style.display = iconIsHidden() ? 'none' : 'flex';

  if (import.meta.env.DEV) {
    console.log('[SafeTyper UI] Icon display set to flex');
    console.log('[SafeTyper UI] Icon final styles:', {
      display: iconContainer.style.display,
      left: iconContainer.style.left,
      top: iconContainer.style.top,
      position: window.getComputedStyle(iconContainer).position,
      visibility: window.getComputedStyle(iconContainer).visibility,
      opacity: window.getComputedStyle(iconContainer).opacity,
    });
  }
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
 * Position icon near a text selection Range
 */
export function positionIconAtSelection(range: Range): void {
  if (iconIsHidden()) {
    hideIcon();
    return;
  }
  const iconContainer = stateManager.getIconContainer();
  if (!iconContainer) return;

  const position = calculateSelectionIconPosition(range);
  const cachedPosition = stateManager.getCachedPosition();

  if (
    !cachedPosition ||
    cachedPosition.left !== position.left ||
    cachedPosition.top !== position.top
  ) {
    iconContainer.style.left = `${position.left}px`;
    iconContainer.style.top = `${position.top}px`;
    stateManager.setCachedPosition(position);
  }

  const luminance = backdropLuminance(position);
  const surface = luminance !== null && luminance <= 0.45 ? 'dark' : 'light';
  if (surface !== iconSurface) {
    iconSurface = surface;
    syncIconFace(iconContainer);
  }
  iconContainer.style.display = 'flex';
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
      <img class="st-logo" alt="" src="${browser.runtime.getURL('/icon/32.png')}" />
      <div class="st-heading"><strong>SafeTyper</strong><span class="st-count" aria-live="polite"></span></div>
      <button type="button" class="st-accept-all" hidden>Accept all</button>
      <button type="button" class="st-close" aria-label="Close">×</button>
    </div>
    <div class="safetyper-popup-content">
      <p class="st-loading">Checking...</p>
    </div>
  `;
  shadow.append(style, root);
  root.querySelector('.st-close')?.addEventListener('click', closePopup);
  activeKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopup();
    }
  };
  document.addEventListener('keydown', activeKeyDown);

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
  const shown = focused.length > 0 ? focused : issues;
  const popup = stateManager.getPopup() ?? mountPopupShell();
  const content = popupContent(popup);
  if (!content) return;
  renderSuggestionCards(content, sessionForField(anchor, text, shown));
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
      renderSuggestionCards(content, sessionForField(field, snap.text, snap.issues));
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
        if (popup) {
          popup.setAttribute('data-theme', currentTheme);
          popupRoot(popup)?.setAttribute('data-theme', currentTheme);
        }
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
  const icon = stateManager.getIconContainer();
  const field = stateManager.getActiveInput() ?? stateManager.getSelectionAnchorElement();
  const iconRect = icon?.getBoundingClientRect() ?? field?.getBoundingClientRect();
  if (!iconRect) {
    constrainPopupToViewport(popup);
    return;
  }
  const rect = popup.getBoundingClientRect();
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
  area.focus();
  area.select();
}

function renderSuggestionCards(content: HTMLElement, session: SuggestionSession): void {
  const popup = stateManager.getPopup();
  const root = popupRoot(popup);
  const count = root?.querySelector('.st-count');
  const acceptAll = root?.querySelector('.st-accept-all');
  const remaining = session.suggestions.length;
  if (count) {
    count.textContent =
      remaining === 0
        ? session.initialEmpty
          ? 'Nothing to change'
          : 'All done'
        : `${remaining} suggestion${remaining === 1 ? '' : 's'}`;
  }
  if (acceptAll instanceof HTMLButtonElement) {
    acceptAll.hidden = remaining === 0;
    acceptAll.textContent = session.isComplex ? 'Copy all' : 'Accept all';
    acceptAll.setAttribute(
      'aria-label',
      session.isComplex ? 'Copy all corrected text' : 'Accept all suggestions'
    );
    acceptAll.onclick = () => {
      const corrected = applySuggestions(session.workingText, session.suggestions);
      if (session.isComplex) {
        void copyText(corrected).then((ok) => {
          if (!ok) {
            showManualCopy(content, corrected);
            return;
          }
          session.suggestions = [];
          session.initialEmpty = false;
          renderSuggestionCards(content, session);
        });
        return;
      }
      session.workingText = corrected;
      writeSession(session);
      session.suggestions = [];
      session.initialEmpty = false;
      renderSuggestionCards(content, session);
    };
  }

  content.replaceChildren();
  if (remaining === 0) {
    const done = document.createElement('p');
    done.className = 'st-done';
    done.setAttribute('role', 'status');
    done.textContent = session.initialEmpty ? 'Nothing to change' : 'All done';
    content.append(done);
    window.clearTimeout(suggestionCloseTimer);
    suggestionCloseTimer = window.setTimeout(closePopup, 1600);
    return;
  }

  window.clearTimeout(suggestionCloseTimer);
  if (session.isComplex) {
    const note = document.createElement('p');
    note.className = 'st-notice';
    note.textContent = 'This editor cannot be edited directly. Copy a fix and paste it.';
    content.append(note);
  }

  const list = document.createElement('div');
  list.className = 'st-list';
  for (const suggestion of session.suggestions) {
    const card = document.createElement('article');
    card.className = 'st-card';
    const category = document.createElement('p');
    category.className = 'st-category';
    category.textContent = suggestion.category;
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
      if (session.isComplex) {
        void copyText(suggestion.replacement).then((ok) => {
          if (!ok) {
            showManualCopy(content, suggestion.replacement);
            return;
          }
          session.suggestions = session.suggestions.filter((item) => item.id !== suggestion.id);
          session.initialEmpty = false;
          renderSuggestionCards(content, session);
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
      renderSuggestionCards(content, session);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'st-btn';
    dismiss.textContent = 'Dismiss';
    dismiss.setAttribute('aria-label', `Dismiss suggestion for ${original || 'this text'}`);
    dismiss.addEventListener('click', () => {
      session.suggestions = session.suggestions.filter((item) => item.id !== suggestion.id);
      session.initialEmpty = false;
      renderSuggestionCards(content, session);
    });
    actions.append(accept, dismiss);
    card.append(category, quote, explanation, actions);
    list.append(card);
  }
  content.append(list);
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

  const popup = stateManager.getPopup();
  if (popup) {
    const content = popupContent(popup);
    if (content) {
      popup.dataset.busy = '1';
      const count = popupRoot(popup)?.querySelector('.st-count');
      if (count) count.textContent = 'Checking…';
      content.innerHTML = '<p class="st-loading">Checking grammar...</p>';
      setIconActivity('checking');
    }
  }

  try {
    const result = await checkGrammar(text);
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

    setIconActivity(result.suggestions.length > 0 ? 'issues' : 'clean', result.suggestions);
    renderSuggestionCards(content, {
      workingText: text,
      suggestions: result.suggestions,
      canApply,
      isComplex,
      anchor,
      prefix,
      suffix,
      range,
      insertedNode: null,
      initialEmpty: result.suggestions.length === 0,
    });
    setTimeout(() => repositionPopup(currentPopup), 0);
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error('Grammar check error:', error);
    }
    const errorPopup = stateManager.getPopup();
    if (errorPopup) {
      const content = popupContent(errorPopup);
      if (content) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errorPopup.dataset.busy = '';
        content.innerHTML = `<p class="st-error">Error checking grammar: ${escapeHtml(message)}</p>`;

        setTimeout(() => repositionPopup(errorPopup), 0);
      }
    }
  }
}
