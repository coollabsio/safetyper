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

// Track document-level listeners for cleanup
let activeDragEnd: (() => void) | null = null;
let activeDragMove: ((e: MouseEvent) => void) | null = null;

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
      <circle cx="10" cy="10" r="9" stroke="#6b16ed" stroke-width="2" fill="none"/>
      <path d="M6 8.5C6 8.5 8 6 10 6C12 6 14 8.5 14 8.5" stroke="#6b16ed" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M10 10V14" stroke="#6b16ed" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="10" cy="14" r="0.5" fill="#6b16ed"/>
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
    <div class="popup-header">
      <div class="drag-handle" title="Drag to move">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4" r="1.5" fill="#d4d4d4"/>
          <circle cx="12" cy="4" r="1.5" fill="#d4d4d4"/>
          <circle cx="4" cy="8" r="1.5" fill="#d4d4d4"/>
          <circle cx="12" cy="8" r="1.5" fill="#d4d4d4"/>
          <circle cx="4" cy="12" r="1.5" fill="#d4d4d4"/>
          <circle cx="12" cy="12" r="1.5" fill="#d4d4d4"/>
        </svg>
      </div>
      <h3>SafeTyper</h3>
      <div class="header-spacer"></div>
    </div>
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

  // Check if API key exists for the active provider
  browser.storage.local.get(['selectedProvider', 'openRouterKey', 'groqKey']).then((result) => {
    const provider = result.selectedProvider || 'openrouter';
    const hasApiKey = provider === 'openrouter' ? !!result.openRouterKey : !!result.groqKey;

    if (popup) {
      const content = popup.querySelector('.safetyper-popup-content');
      if (content) {
        if (hasApiKey) {
          content.innerHTML = `
            <p class="popup-description">Check your text for grammar and spelling errors</p>
            <div class="popup-actions">
              <button class="safetyper-check-btn">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Check Grammar
              </button>
              <button class="safetyper-settings-btn safetyper-icon-btn" title="Settings">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15V15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          `;

          const checkBtn = content.querySelector('.safetyper-check-btn');
          if (checkBtn) {
            checkBtn.addEventListener('click', handleGrammarCheck);
          }
        } else {
          content.innerHTML = `
            <p class="popup-description error-message">Please set your API key in Settings to get started</p>
            <div class="popup-actions">
              <button class="safetyper-settings-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
                  <path d="M12 1V4M12 20V23M23 12H20M4 12H1M19.07 4.93L17 7M7 17L4.93 19.07M19.07 19.07L17 17M7 7L4.93 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Open Settings
              </button>
            </div>
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

  popupElement.addEventListener('mousedown', dragStart);
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
  if (popup && !popup.querySelector('.loading')) {
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

/**
 * Handle grammar check button click
 */
async function handleGrammarCheck(): Promise<void> {
  const activeInput = stateManager.getActiveInput();
  if (!activeInput) return;

  const text = getTextContent(activeInput);
  if (!text.trim()) {
    const popup = stateManager.getPopup();
    if (popup) {
      const content = popup.querySelector('.safetyper-popup-content');
      if (content) {
        content.innerHTML = `
          <p class="popup-description error-message">Please enter some text to check grammar.</p>
          <div class="popup-actions">
            <button class="safetyper-close-btn">Close</button>
          </div>
        `;
        const closeBtn = content.querySelector('.safetyper-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', closePopup);
        }
      }
    }
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

    // Re-fetch popup reference after async boundary
    const currentPopup = stateManager.getPopup();
    if (!currentPopup) return;

    const content = currentPopup.querySelector('.safetyper-popup-content');
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

      // Ensure popup stays within viewport after content update
      setTimeout(() => constrainPopupToViewport(currentPopup), 0);
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

      // Ensure popup stays within viewport after content update
      setTimeout(() => constrainPopupToViewport(currentPopup), 0);

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
              button.style.color = '#fff';
              button.style.borderColor = '#4CAF50';
              setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '';
                button.style.color = '';
                button.style.borderColor = '';
              }, 2000);
            })
            .catch(() => {
              // Fallback: show text in popup for manual copy
              const fallbackPopup = stateManager.getPopup();
              if (fallbackPopup) {
                const fallbackContent = fallbackPopup.querySelector('.safetyper-popup-content');
                if (fallbackContent) {
                  fallbackContent.innerHTML = `
                    <p class="popup-description">Clipboard access denied. Please copy the text below manually:</p>
                    <textarea class="manual-copy-text" readonly style="width:100%;min-height:80px;font-size:13px;padding:8px;border:1px solid #e5e5e5;border-radius:4px;resize:vertical;">${escapeHtml(textToCopy)}</textarea>
                    <div class="popup-actions"><button class="safetyper-close-btn">Close</button></div>
                  `;
                  const closeBtn = fallbackContent.querySelector('.safetyper-close-btn');
                  if (closeBtn) closeBtn.addEventListener('click', closePopup);
                }
              }
            });
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', closePopup);
      }
    }
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error('Grammar check error:', error);
    }
    const errorPopup = stateManager.getPopup();
    if (errorPopup) {
      const content = errorPopup.querySelector('.safetyper-popup-content');
      if (content) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        content.innerHTML = `
          <p class="error">Error checking grammar: ${escapeHtml(message)}</p>
          <button class="safetyper-close-btn">Close</button>
        `;

        // Ensure popup stays within viewport after content update
        setTimeout(() => constrainPopupToViewport(errorPopup), 0);

        const closeBtn = content.querySelector('.safetyper-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', closePopup);
        }
      }
    }
  }
}
