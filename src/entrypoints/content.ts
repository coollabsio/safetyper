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
  positionIconAtSelection,
  hideIcon,
  loadTheme,
  updateTheme,
} from '~/lib/content/ui-manager';
import {
  isEditableElement,
  isSignificantKeyEvent,
  isSelectionInEditableArea,
  findEditableAncestor,
} from '~/lib/content/dom-utils';
import { CONFIG } from '~/lib/content/config';

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Content script starting...');
      console.log('[SafeTyper] Location:', window.location.href);
    }

    // Load theme before setting up UI
    await loadTheme();

    // Listen for theme changes from settings
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.darkMode) {
        updateTheme(changes.darkMode.newValue === true);
      }
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

        iconContainer.style.display = 'flex';
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
        // Track typing speed
        const now = Date.now();
        const lastTypingTime = stateManager.getLastTypingTime();
        if (lastTypingTime > 0) {
          const timeDiff = now - lastTypingTime;
          stateManager.addTypingSpeedMeasurement(timeDiff);
        }
        stateManager.setLastTypingTime(now);

        // Update active input if needed
        if (stateManager.getActiveInput() !== activeElement) {
          stateManager.setActiveInput(activeElement);
          if (!stateManager.getIconContainer()) createIcon();
        }

        // Show and position icon with adaptive debouncing
        const iconContainer = stateManager.getIconContainer();
        if (iconContainer) {
          iconContainer.style.display = 'flex';

          // Clear existing timer
          const existingTimer = stateManager.getTypingTimer();
          if (existingTimer !== null) {
            clearTimeout(existingTimer);
          }

          // Use adaptive debounce time
          const debounceTime = stateManager.getAdaptiveDebounceTime();
          const timer = window.setTimeout(() => {
            const activeInput = stateManager.getActiveInput();
            if (activeInput) {
              positionIcon(activeInput);
            }
          }, debounceTime);

          stateManager.setTypingTimer(timer);
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
      const iconContainer = stateManager.getIconContainer();
      if (!iconContainer || iconContainer.style.display === 'none') return;

      if (stateManager.getInteractionMode() === 'selection') {
        const savedRange = stateManager.getSelectedRange();
        if (savedRange) positionIconAtSelection(savedRange);
      } else {
        const activeInput = stateManager.getActiveInput();
        if (activeInput) positionIcon(activeInput);
      }
    }

    /**
     * Handle scroll — reposition icon to follow the input field
     */
    let scrollRafId: number | null = null;
    function handleScroll(): void {
      if (scrollRafId) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        const iconContainer = stateManager.getIconContainer();
        if (!iconContainer || iconContainer.style.display === 'none') return;

        if (stateManager.getInteractionMode() === 'selection') {
          const savedRange = stateManager.getSelectedRange();
          if (savedRange) positionIconAtSelection(savedRange);
        } else {
          const activeInput = stateManager.getActiveInput();
          if (activeInput) positionIcon(activeInput);
        }
      });
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

            // Keep icon at its current focus-mode position (we can't get pixel
            // coords of the selection inside a form control)
            const iconContainer = stateManager.getIconContainer() || createIcon();
            iconContainer.style.display = 'flex';
            positionIcon(activeEl);
            return;
          }

          // Selection collapsed inside input/textarea — revert to focus mode
          // But preserve selection state if popup is open (user clicked the icon)
          if (stateManager.getInteractionMode() === 'selection' && !stateManager.getPopup()) {
            stateManager.clearSelectionState();
            // Re-show focus-mode icon since the field is still focused
            if (isEditableElement(activeEl)) {
              stateManager.setActiveInput(activeEl);
              const iconContainer = stateManager.getIconContainer() || createIcon();
              iconContainer.style.display = 'flex';
              positionIcon(activeEl);
            }
          }
          return;
        }

        // --- Contenteditable path ---
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          // Selection cleared — if in selection mode, hide icon and clear state
          // But preserve state if popup is open (user clicked the icon)
          if (stateManager.getInteractionMode() === 'selection' && !stateManager.getPopup()) {
            hideIcon();
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
        if (ancestorEl?.closest('.safetyper-popup, .safetyper-icon')) return;

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

        // Show and position icon at selection
        const iconContainer = stateManager.getIconContainer() || createIcon();
        iconContainer.style.display = 'flex';
        positionIconAtSelection(range);
      }, CONFIG.SELECTION_DEBOUNCE);
    }

    /**
     * Cleanup function
     */
    function cleanup(): void {
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

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

    // Log initialization
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] ✅ Content script fully initialized and ready');
    }
  },
});
