/**
 * SafeTyper Content Script
 * Refactored to use modular architecture
 */

import '~/assets/fonts/fonts.css';
import '../styles/content.css';
import { stateManager } from '~/lib/content/state-manager';
import { createIcon, positionIcon, hideIcon } from '~/lib/content/ui-manager';
import { isEditableElement, isSignificantKeyEvent } from '~/lib/content/dom-utils';
import { CONFIG } from '~/lib/content/config';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Content script starting...');
      console.log('[SafeTyper] Location:', window.location.href);
    }

    if (import.meta.env.DEV) {
      console.log('[SafeTyper] Content script main() started');
      console.log('[SafeTyper] Modules loaded:', {
        stateManager: !!stateManager,
        createIcon: !!createIcon,
        positionIcon: !!positionIcon,
        hideIcon: !!hideIcon,
        isEditableElement: !!isEditableElement,
        isSignificantKeyEvent: !!isSignificantKeyEvent,
        CONFIG: !!CONFIG
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
    function handleBlur(e: FocusEvent): void {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const isSwitchingToEditable = relatedTarget ? isEditableElement(relatedTarget) : false;

      setTimeout(() => {
        const popup = stateManager.getPopup();
        if (!isSwitchingToEditable && !popup) {
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
      const activeInput = stateManager.getActiveInput();
      const iconContainer = stateManager.getIconContainer();
      if (activeInput && iconContainer && iconContainer.style.display !== 'none') {
        positionIcon(activeInput);
      }
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
      window.removeEventListener('resize', handleResize);
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
    window.addEventListener('resize', handleResize);

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
