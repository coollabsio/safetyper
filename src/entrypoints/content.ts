/**
 * SafeTyper Content Script
 * Refactored to use modular architecture
 */

import '~/assets/fonts/fonts.css';
import '../styles/content.css';
import { browser } from 'wxt/browser';
import { stateManager } from '~/lib/content/state-manager';
import {
  createIcon,
  positionIcon,
  hideIcon,
  loadTheme,
  updateTheme,
  loadIconPreferences,
  openSuggestionsShortcut,
  scheduleIconPosition,
  mountIconStateGallery,
  applyIconSize,
} from '~/lib/content/ui-manager';
import { iconIsHidden } from '~/lib/content/icon-metrics';
import {
  isEditableElement,
  isSignificantKeyEvent,
  isSelectionInEditableArea,
  findEditableAncestor,
} from '~/lib/content/dom-utils';
import { CONFIG } from '~/lib/content/config';
import { startAutoCheck } from '~/lib/content/auto-check-runner';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  async main() {
    // Manifest registration plus the dev-mode programmatic registration can
    // inject this file twice. A second copy would subscribe another auto-check
    // and fire a duplicate Ollama request for every pause in typing.
    const marker = window as Window & { __safetyperContent?: boolean };
    if (marker.__safetyperContent) return;
    marker.__safetyperContent = true;

    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Content script starting...');
      console.log('[SafeTyper] Location:', window.location.href);
    }

    // Load theme before setting up UI
    await loadTheme();
    await loadIconPreferences();
    mountIconStateGallery();

    // Listen for theme changes from settings
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.darkMode) updateTheme(changes.darkMode.newValue === true);
      if (changes.iconSize) applyIconSize(changes.iconSize.newValue);
    });

    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Content script main() started');
      console.log('[SafeTyper] Modules loaded:', {
        stateManager: !!stateManager,
        createIcon: !!createIcon,
        positionIcon: !!positionIcon,
        hideIcon: !!hideIcon,
        isEditableElement: !!isEditableElement,
        isSignificantKeyEvent: !!isSignificantKeyEvent,
        CONFIG: !!CONFIG,
      });
    }

    /**
     * Handle input focus events
     */
    function handleFocus(e: FocusEvent): void {
      const target = e.target as HTMLElement;
      if (import.meta.env.DEV) {
        console.log('[SafeTyper] Focus event:', target.tagName, target);
        console.log('[SafeTyper] Is editable?', isEditableElement(target));
      }

      if (isEditableElement(target)) {
        if (import.meta.env.DEV) {
          console.log('[SafeTyper] Setting active input');
        }
        // Clear selection mode when focusing an editable field
        if (stateManager.getInteractionMode() === 'selection') {
          stateManager.clearSelectionState();
        }
        stateManager.setActiveInput(target);
        const iconContainer = stateManager.getIconContainer() || createIcon();

        if (import.meta.env.DEV) {
          console.log('[SafeTyper] Icon container:', iconContainer);
        }

        if (!iconIsHidden()) iconContainer.style.display = 'flex';
        positionIcon(target);
      }
    }

    /**
     * Handle input blur events
     */
    function handleBlur(): void {
      setTimeout(() => {
        // Don't hide icon if in selection mode
        if (stateManager.getInteractionMode() === 'selection') return;

        const popup = stateManager.getPopup();
        const currentActive = document.activeElement as HTMLElement | null;
        const hasEditableFocus = currentActive && isEditableElement(currentActive);
        if (!hasEditableFocus && !popup) {
          hideIcon();
          stateManager.setActiveInput(null);
          stateManager.setCachedPosition(null);
          stateManager.setLastInputRect(null);
        }
      }, CONFIG.BLUR_DELAY);
    }

    /**
     * Handle keydown events for global typing detection
     */
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSuggestionsShortcut();
        return;
      }

      // Skip if in IME composition
      if (stateManager.isComposingActive()) {
        return;
      }

      // Only process significant key events
      if (!isSignificantKeyEvent(e)) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement;

      if (activeElement && isEditableElement(activeElement)) {
        // Track typing speed. The icon stays where it is; a resize observer
        // follows the field if the box actually grows.
        const now = Date.now();
        const lastTypingTime = stateManager.getLastTypingTime();
        if (lastTypingTime > 0) {
          const timeDiff = now - lastTypingTime;
          stateManager.addTypingSpeedMeasurement(timeDiff);
        }
        stateManager.setLastTypingTime(now);

        if (stateManager.getActiveInput() !== activeElement) {
          stateManager.setActiveInput(activeElement);
          if (!stateManager.getIconContainer()) createIcon();
          if (!iconIsHidden()) positionIcon(activeElement);
        }
      }
    }

    /**
     * Handle IME composition start
     */
    function handleCompositionStart(): void {
      stateManager.setIsComposing(true);
    }

    /**
     * Handle IME composition end
     */
    function handleCompositionEnd(): void {
      stateManager.setIsComposing(false);
      const activeInput = stateManager.getActiveInput();
      const iconContainer = stateManager.getIconContainer();
      if (activeInput && iconContainer) {
        positionIcon(activeInput);
      }
    }

    /**
     * Handle window resize
     */
    function handleResize(): void {
      scheduleIconPosition();
    }

    /**
     * Scroll events from nested containers bubble here in the capture phase.
     * scheduleIconPosition already collapses a burst into one frame.
     */
    function handleScroll(): void {
      scheduleIconPosition();
    }

    /**
     * Handle text selection changes
     */
    let selectionDebounceTimer: number | null = null;
    function handleSelectionChange(): void {
      if (selectionDebounceTimer !== null) {
        clearTimeout(selectionDebounceTimer);
      }

      selectionDebounceTimer = window.setTimeout(() => {
        selectionDebounceTimer = null;

        const activeEl = document.activeElement;

        // --- Input / Textarea path ---
        // window.getSelection() doesn't reflect selections inside form controls,
        // so we check .selectionStart / .selectionEnd directly.
        if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
          if (!isEditableElement(activeEl)) return;
          const start = activeEl.selectionStart;
          const end = activeEl.selectionEnd;
          if (start !== null && end !== null && start !== end) {
            const selectedText = activeEl.value.substring(start, end);
            if (selectedText.trim().length < CONFIG.MIN_SELECTION_LENGTH) return;

            stateManager.setInteractionMode('selection');
            stateManager.setSelectedText(selectedText);
            stateManager.setSelectedRange(null);
            stateManager.setSelectionInEditable(true);
            stateManager.setSelectionAnchorElement(activeEl);
            stateManager.setSelectionStartOffset(start);
            stateManager.setSelectionEndOffset(end);
            return;
          }

          // Selection collapsed inside input/textarea — revert to focus mode.
          // The icon stays on the field; hiding it here flickers while selecting.
          if (stateManager.getInteractionMode() === 'selection' && !stateManager.getPopup()) {
            stateManager.clearSelectionState();
            if (isEditableElement(activeEl)) stateManager.setActiveInput(activeEl);
          }
          return;
        }

        // --- Contenteditable path ---
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          // A collapsed caret is normal while typing. Leave the icon where it is.
          if (stateManager.getInteractionMode() === 'selection' && !stateManager.getPopup()) {
            stateManager.clearSelectionState();
          }
          return;
        }

        const selectedText = selection.toString().trim();
        if (selectedText.length < CONFIG.MIN_SELECTION_LENGTH) return;

        const range = selection.getRangeAt(0);

        // Ignore selections inside SafeTyper UI
        const commonAncestor = range.commonAncestorContainer;
        const ancestorEl =
          commonAncestor.nodeType === Node.TEXT_NODE
            ? commonAncestor.parentElement
            : (commonAncestor as HTMLElement);
        if (ancestorEl?.closest('.safetyper-popup, .safetyper-popup-host, .safetyper-icon')) {
          return;
        }
        const root = ancestorEl?.getRootNode();
        if (
          root instanceof ShadowRoot &&
          root.host instanceof HTMLElement &&
          root.host.classList.contains('safetyper-popup-host')
        ) {
          return;
        }

        // Only activate for selections inside editable elements
        if (!isSelectionInEditableArea(selection)) return;
        const editableAncestor = findEditableAncestor(commonAncestor);
        if (!editableAncestor) return;

        // Store selection state
        stateManager.setInteractionMode('selection');
        stateManager.setSelectedText(selection.toString());
        stateManager.setSelectedRange(range.cloneRange());
        stateManager.setSelectionInEditable(true);
        stateManager.setSelectionAnchorElement(editableAncestor);
        stateManager.setSelectionStartOffset(null);
        stateManager.setSelectionEndOffset(null);
      }, CONFIG.SELECTION_DEBOUNCE);
    }

    /**
     * Cleanup function
     */
    let stopAutoCheck = (): void => {};

    function cleanup(): void {
      stopAutoCheck();
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleBlur);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('compositionstart', handleCompositionStart);
      document.removeEventListener('compositionend', handleCompositionEnd);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      if (selectionDebounceTimer !== null) clearTimeout(selectionDebounceTimer);
      observer.disconnect();
      stateManager.cleanup();
    }

    // Add event listeners
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Adding event listeners');
    }

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleBlur);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('compositionstart', handleCompositionStart);
    document.addEventListener('compositionend', handleCompositionEnd);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Event listeners added');
    }

    // Handle dynamically added inputs
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const element = node as HTMLElement;
            if (isEditableElement(element)) {
              if (import.meta.env.DEV) {
                console.log('[SafeTyper] New editable element added:', element);
              }
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    if (import.meta.env.DEV) {
      console.log('[SafeTyper] MutationObserver initialized');
    }

    stopAutoCheck = startAutoCheck();

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

    // Log initialization
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] ✅ Content script fully initialized and ready');
    }
  },
});
