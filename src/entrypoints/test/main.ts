/**
 * Test page script - loads content script for testing on extension pages
 * DEV MODE ONLY
 */

if (!import.meta.env.DEV) {
  document.body.innerHTML = '<p>This page is only available in development mode.</p>';
  throw new Error('Test page is dev-only');
}

// Import content script CSS
import '~/assets/fonts/fonts.css';
import '../../styles/content.css';

// Import and initialize content script modules
import { stateManager } from '~/lib/content/state-manager';
import { createIcon, positionIcon, hideIcon } from '~/lib/content/ui-manager';
import { isEditableElement, isSignificantKeyEvent } from '~/lib/content/dom-utils';
import { CONFIG } from '~/lib/content/config';

console.log('🧪 [Test Page] Loading SafeTyper content script...');

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}

function initContentScript() {
  console.log('🧪 [Test Page] Initializing content script on extension page');

  /**
   * Handle input focus events
   */
  function handleFocus(e: FocusEvent): void {
    const target = e.target as HTMLElement;
    console.log('🧪 [Test Page] Focus event:', target.tagName);

    if (isEditableElement(target)) {
      console.log('🧪 [Test Page] Editable element focused');
      stateManager.setActiveInput(target);
      const iconContainer = stateManager.getIconContainer() || createIcon();
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
    if (stateManager.isComposingActive()) {
      return;
    }

    if (!isSignificantKeyEvent(e)) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement;

    if (activeElement && isEditableElement(activeElement)) {
      const now = Date.now();
      const lastTypingTime = stateManager.getLastTypingTime();
      if (lastTypingTime > 0) {
        const timeDiff = now - lastTypingTime;
        stateManager.addTypingSpeedMeasurement(timeDiff);
      }
      stateManager.setLastTypingTime(now);

      if (stateManager.getActiveInput() !== activeElement) {
        stateManager.setActiveInput(activeElement);
        const iconContainer = stateManager.getIconContainer() || createIcon();
      }

      const iconContainer = stateManager.getIconContainer();
      if (iconContainer) {
        iconContainer.style.display = 'flex';

        const existingTimer = stateManager.getTypingTimer();
        if (existingTimer !== null) {
          clearTimeout(existingTimer);
        }

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

  // Add event listeners
  document.addEventListener('focusin', handleFocus);
  document.addEventListener('focusout', handleBlur);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('compositionstart', handleCompositionStart);
  document.addEventListener('compositionend', handleCompositionEnd);
  window.addEventListener('resize', handleResize);

  console.log('🧪 [Test Page] ✅ Content script initialized successfully');
}
