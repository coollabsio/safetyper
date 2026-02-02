/**
 * DOM utility functions for SafeTyper content script
 */

import type { Position } from './types';
import { CONFIG } from './config';

/**
 * Check if an element is editable
 */
export function isEditableElement(element: HTMLElement): boolean {
  // Check for standard input types
  if (element.tagName === 'INPUT') {
    const inputType = (element as HTMLInputElement).type;
    const isEditable = ['text', 'search', 'url', 'tel'].includes(inputType);
    if (import.meta.env.DEV && isEditable) {
      console.log('[SafeTyper DOM] Found editable INPUT:', inputType);
    }
    return isEditable;
  }

  // Check for textarea
  if (element.tagName === 'TEXTAREA') {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper DOM] Found TEXTAREA');
    }
    return true;
  }

  // Check for contenteditable elements
  if (element.isContentEditable) {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper DOM] Found contentEditable element');
    }
    return true;
  }

  // Check for specific roles that might be editable
  const role = element.getAttribute('role');
  if (role === 'textbox' || role === 'combobox') {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper DOM] Found element with role:', role);
    }
    return true;
  }

  // Check for data attributes that indicate editability
  if (element.hasAttribute('data-editable') || element.hasAttribute('data-contenteditable')) {
    if (import.meta.env.DEV) {
      console.log('[SafeTyper DOM] Found element with data-editable attribute');
    }
    return true;
  }

  return false;
}

/**
 * Check if a key event represents significant text input
 */
export function isSignificantKeyEvent(event: KeyboardEvent): boolean {
  // Ignore modifier keys when pressed alone
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(event.key)) {
    return false;
  }

  // Ignore navigation keys
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
    return false;
  }

  // Ignore function keys
  if (event.key.startsWith('F') && event.key.length <= 3 && /^\d+$/.test(event.key.substring(1))) {
    return false;
  }

  // Ignore specific control combinations that don't add text
  if (event.ctrlKey || event.metaKey) {
    if (['a', 'c', 'v', 'x', 'z', 'y', 's', 'f', 'r', 'n', 't', 'w'].includes(event.key.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Get text content from an element
 */
export function getTextContent(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  // For contenteditable elements, use innerText which respects visual formatting
  // and avoids capturing HTML indentation/whitespace
  if (element.contentEditable === 'true' && element.innerText !== undefined) {
    return element.innerText;
  }

  return element.textContent || '';
}

/**
 * Set text content to an element
 */
export function setTextContent(element: HTMLElement, text: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = text;
  } else if (element.contentEditable === 'true') {
    // For contenteditable elements, use innerText to preserve line breaks as visual formatting
    // This is more reliable than execCommand which is deprecated
    try {
      // Save cursor position
      const selection = window.getSelection();
      const hadFocus = document.activeElement === element;

      // Set the text
      element.innerText = text;

      // Restore focus if element had it
      if (hadFocus) {
        element.focus();
        // Move cursor to end
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false); // Collapse to end
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } catch (error) {
      console.warn('Contenteditable update failed:', error);
      element.textContent = text;
    }
  } else {
    element.textContent = text;
  }
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if element position has changed significantly
 */
export function hasPositionChanged(
  lastRect: DOMRect | null,
  currentRect: DOMRect,
  threshold: number = 1
): boolean {
  if (!lastRect) return true;

  return (
    Math.abs(lastRect.left - currentRect.left) >= threshold ||
    Math.abs(lastRect.top - currentRect.top) >= threshold ||
    Math.abs(lastRect.width - currentRect.width) >= threshold ||
    Math.abs(lastRect.height - currentRect.height) >= threshold
  );
}

/**
 * Calculate position for icon based on element
 */
export function calculateIconPosition(element: HTMLElement): Position {
  const rect = element.getBoundingClientRect();
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  return {
    left: rect.right + scrollLeft - CONFIG.ICON_OFFSET,
    top: rect.bottom + scrollTop - CONFIG.ICON_OFFSET,
  };
}

/**
 * Calculate position for popup to fit within viewport
 */
export function calculatePopupPosition(
  iconRect: DOMRect,
  popupWidth: number,
  popupHeight: number
): Position {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = iconRect.left - 200;
  let top = iconRect.bottom + 10;

  // Adjust horizontal position if popup would go off screen
  if (left + popupWidth > viewportWidth) {
    left = viewportWidth - popupWidth - 10;
  }
  if (left < 0) {
    left = 10;
  }

  // Adjust vertical position if popup would go off screen
  if (top + popupHeight > viewportHeight) {
    top = iconRect.top - popupHeight - 10;
  }
  if (top < 0) {
    top = 10;
  }

  return { left, top };
}

/**
 * Check if element is a complex editor (like Draft.js)
 */
export function isComplexEditor(element: HTMLElement): boolean {
  return (
    element.contentEditable === 'true' &&
    element.classList.contains('public-DraftEditor-content')
  );
}
