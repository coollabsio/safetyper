/**
 * UI Manager for SafeTyper content script
 * Handles icon, popup creation and interaction
 */

import { browser } from 'wxt/browser';
import { stateManager } from './state-manager';
import { checkGrammar } from './api-client';
import { generateDiffHtml } from './diff-engine';
import {
  calculateIconPosition,
  calculatePopupPosition,
  getTextContent,
  setTextContent,
  isComplexEditor,
  escapeHtml,
} from './dom-utils';

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
  iconContainer.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="9" stroke="#4A90E2" stroke-width="2" fill="white"/>
      <path d="M6 8.5C6 8.5 8 6 10 6C12 6 14 8.5 14 8.5" stroke="#4A90E2" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 10V14" stroke="#4A90E2" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="10" cy="14" r="0.5" fill="#4A90E2"/>
    </svg>
  `;

  iconContainer.addEventListener('click', showPopup);
  iconContainer.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showPopup(e);
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
 * Position icon near the active input
 */
export function positionIcon(element: HTMLElement): void {
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
  if (!cachedPosition || cachedPosition.left !== position.left || cachedPosition.top !== position.top) {
    iconContainer.style.left = `${position.left}px`;
    iconContainer.style.top = `${position.top}px`;
    stateManager.setCachedPosition(position);

    if (import.meta.env.DEV) {
      console.log('[SafeTyper UI] Icon position updated:', position);
    }
  }

  iconContainer.style.display = 'flex';

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
  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    iconContainer.style.display = 'none';
  }
}

/**
 * Show grammar check popup
 */
export function showPopup(e: Event): void {
  e.stopPropagation();

  let popup = stateManager.getPopup();
  if (popup) {
    popup.remove();
    stateManager.setPopup(null);
    return;
  }

  popup = document.createElement('div');
  popup.className = 'safetyper-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Grammar check dialog');
  popup.innerHTML = `
    <div class="draggable-indicator">drag me</div>
    <div class="safetyper-popup-content">
      <div class="loading">Loading...</div>
    </div>
  `;

  // Position popup
  const iconContainer = stateManager.getIconContainer();
  if (iconContainer) {
    const iconRect = iconContainer.getBoundingClientRect();
    const position = calculatePopupPosition(iconRect, 450, 200);
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
  }

  document.body.appendChild(popup);
  stateManager.setPopup(popup);

  makePopupDraggable(popup);

  // Check if API key exists
  browser.storage.local.get(['openRouterKey']).then((result) => {
    const hasApiKey = !!result.openRouterKey;

    if (popup) {
      const content = popup.querySelector('.safetyper-popup-content');
      if (content) {
        if (hasApiKey) {
          content.innerHTML = `
            <button class="safetyper-check-btn">Check Grammar</button>
            <button class="safetyper-settings-btn">Settings</button>
          `;

          const checkBtn = content.querySelector('.safetyper-check-btn');
          if (checkBtn) {
            checkBtn.addEventListener('click', handleGrammarCheck);
          }
        } else {
          content.innerHTML = `
            <p class="error">Please set your OpenRouter API key in the settings.</p>
            <button class="safetyper-settings-btn">Open Settings</button>
          `;
        }

        const settingsBtn = content.querySelector('.safetyper-settings-btn');
        if (settingsBtn) {
          settingsBtn.addEventListener('click', openSettings);
        }
      }
    }
  });

  // Close popup when clicking outside
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 0);
}

/**
 * Handle click outside popup
 */
function handleOutsideClick(e: MouseEvent): void {
  const popup = stateManager.getPopup();
  // Don't close if loading or clicking close button
  if (popup && !popup.querySelector('.loading')) {
    const target = e.target as Element;
    if (!target.classList.contains('safetyper-close-btn') && !popup.contains(target)) {
      closePopup();
    }
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

  popupElement.addEventListener('mousedown', dragStart);
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('mousemove', drag);

  function dragStart(e: MouseEvent) {
    const target = e.target as Element;
    if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT') {
      return;
    }

    isDragging = true;
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
}

/**
 * Open settings
 */
function openSettings(): void {
  closePopup();
  browser.runtime.sendMessage({ action: 'openPopup' });
}

/**
 * Close popup
 */
export function closePopup(): void {
  const popup = stateManager.getPopup();
  if (popup && !popup.querySelector('.loading')) {
    popup.remove();
    stateManager.setPopup(null);
    document.removeEventListener('click', handleOutsideClick);
  }
}

/**
 * Handle grammar check button click
 */
async function handleGrammarCheck(): Promise<void> {
  const activeInput = stateManager.getActiveInput();
  if (!activeInput) return;

  const text = getTextContent(activeInput);
  if (!text.trim()) {
    alert('Please enter some text to check grammar.');
    return;
  }

  const popup = stateManager.getPopup();
  if (popup) {
    const content = popup.querySelector('.safetyper-popup-content');
    if (content) {
      content.innerHTML = '<div class="loading">Checking grammar...</div>';
    }
  }

  try {
    const correctedText = await checkGrammar(text);

    if (!popup) return;

    const content = popup.querySelector('.safetyper-popup-content');
    if (!content) return;

    // Check if no changes
    if (text.trim() === correctedText.trim()) {
      content.innerHTML = `
        <div class="results-container">
          <div class="no-changes-message">
            <p>Congratulations! This sentence is correct.</p>
          </div>
          <button class="safetyper-close-btn">Close</button>
        </div>
      `;
    } else {
      // Show diff
      const isComplex = activeInput && isComplexEditor(activeInput);
      const buttonsHtml = isComplex
        ? '<button class="safetyper-copy-btn">Copy to Clipboard</button>'
        : `
          <div class="button-group">
            <button class="safetyper-apply-btn">Apply Changes</button>
            <button class="safetyper-copy-btn">Copy to Clipboard</button>
          </div>
        `;

      const instructions = isComplex
        ? '<p class="editor-instruction">Complex editor detected. Copy the text and paste it manually to preserve formatting.</p>'
        : '';

      content.innerHTML = `
        <div class="results-container">
          <div class="diff-container">
            <h4>Changes:</h4>
            <div class="diff-text">${generateDiffHtml(text, correctedText)}</div>
            ${instructions}
          </div>
          ${buttonsHtml}
          <button class="safetyper-close-btn">Close</button>
        </div>
      `;

      // Attach event listeners
      const applyBtn = content.querySelector('.safetyper-apply-btn');
      const copyBtn = content.querySelector('.safetyper-copy-btn');
      const closeBtn = content.querySelector('.safetyper-close-btn');

      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          if (activeInput) {
            setTextContent(activeInput, correctedText);
          }
          closePopup();
        });
      }

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const textToCopy = correctedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          navigator.clipboard
            .writeText(textToCopy)
            .then(() => {
              const button = copyBtn as HTMLElement;
              const originalText = button.textContent;
              button.textContent = 'Copied!';
              button.style.backgroundColor = '#4CAF50';
              setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '';
              }, 2000);
            })
            .catch((error) => {
              console.warn('Clipboard copy failed:', error);
              alert(`Copy this text and paste it manually:\n\n${textToCopy}`);
            });
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', closePopup);
      }
    }
  } catch (error: any) {
    console.error('Grammar check error:', error);
    if (popup) {
      const content = popup.querySelector('.safetyper-popup-content');
      if (content) {
        content.innerHTML = `
          <p class="error">Error checking grammar: ${escapeHtml(error.message || 'Unknown error')}</p>
          <button class="safetyper-close-btn">Close</button>
        `;

        const closeBtn = content.querySelector('.safetyper-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', closePopup);
        }
      }
    }
  }
}
