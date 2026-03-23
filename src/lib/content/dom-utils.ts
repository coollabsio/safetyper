/**
 * DOM utility functions for SafeTyper content script
 */

import type { Position } from './types';
import { CONFIG } from './config';

/**
 * Check if an element is editable
 */
export function isEditableElement(element: HTMLElement): boolean {
  // Exclude elements where spellcheck is explicitly disabled
  if (element.getAttribute('spellcheck') === 'false') return false;

  // Check for standard input types
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    const inputType = input.type;
    const isEditable = ['text', 'search', 'url', 'tel'].includes(inputType);
    if (!isEditable) return false;

    // Exclude readonly inputs and inputs with no text input mode (e.g. React Select dummy inputs)
    if (input.readOnly || element.getAttribute('aria-readonly') === 'true') return false;
    if (element.getAttribute('inputmode') === 'none') return false;

    // Exclude short inputs like OTP/verification code fields (maxlength 1-2)
    if (input.maxLength > 0 && input.maxLength <= 2) return false;

    if (import.meta.env.DEV) {
      console.log('[SafeTyper DOM] Found editable INPUT:', inputType);
    }
    return true;
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
  if (role === 'textbox') {
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
  if (
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.key)
  ) {
    return false;
  }

  // Ignore function keys
  if (event.key.startsWith('F') && event.key.length <= 3 && /^\d+$/.test(event.key.substring(1))) {
    return false;
  }

  // Ignore specific control combinations that don't add text
  if (event.ctrlKey || event.metaKey) {
    if (
      ['a', 'c', 'v', 'x', 'z', 'y', 's', 'f', 'r', 'n', 't', 'w'].includes(event.key.toLowerCase())
    ) {
      return false;
    }
  }

  return true;
}

/** Block-level elements that produce line breaks when walked */
const BLOCK_ELEMENTS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'HR',
  'TR',
]);

/**
 * Extract text from a contenteditable, skipping contenteditable="false" subtrees.
 * Respects block element boundaries as newlines.
 */
function extractEditableText(root: HTMLElement): string {
  const parts: string[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // Skip non-editable islands (UI chrome)
      if (el.getAttribute('contenteditable') === 'false') return;

      if (el.tagName === 'BR') {
        // BR as sole child of a block = empty paragraph marker; the block's \n covers it
        if (
          el.parentElement?.children.length === 1 &&
          el.parentElement.childNodes.length === 1
        ) {
          return;
        }
        parts.push('\n');
        return;
      }

      const isBlock = BLOCK_ELEMENTS.has(el.tagName);

      // Block elements start a new line (if there's content before them)
      if (isBlock && parts.length > 0) {
        parts.push('\n');
      }

      for (const child of node.childNodes) {
        walk(child);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Skip whitespace-only text nodes (HTML formatting between tags)
      if (text.trim()) {
        parts.push(text);
      }
    }
  }

  walk(root);

  // Collapse 3+ newlines to double (paragraph break), trim
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Get text content from an element
 */
export function getTextContent(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  // For all contenteditable elements, use DOM walk for consistent paragraph handling.
  // innerText getter/setter don't round-trip cleanly (block boundaries produce extra \n).
  if (element.contentEditable === 'true' || element.isContentEditable) {
    return extractEditableText(element);
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
    // Complex editors manage their own state — direct DOM mutation corrupts them.
    // The UI should only show "Copy to Clipboard" for these, but guard here too.
    if (isComplexEditor(element)) {
      if (import.meta.env.DEV) {
        console.warn('[SafeTyper DOM] Refusing to set text on complex editor — use copy instead');
      }
      return;
    }

    // Build proper block structure instead of innerText (which creates <br> instead of <div>)
    try {
      const selection = window.getSelection();
      const hadFocus = document.activeElement === element;
      const lines = text.split('\n');

      element.textContent = '';
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          element.appendChild(document.createTextNode(lines[i]));
        } else if (lines[i] === '') {
          const div = document.createElement('div');
          div.appendChild(document.createElement('br'));
          element.appendChild(div);
        } else {
          const div = document.createElement('div');
          div.textContent = lines[i];
          element.appendChild(div);
        }
      }

      if (hadFocus) {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } catch {
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
  const iconSize = CONFIG.ICON_SIZE;
  const iconFits = rect.height >= iconSize + 4;
  const isSingleLineInput = element.tagName === 'INPUT';

  let top: number;
  if (!iconFits) {
    // Icon doesn't fit inside — place above or below the field
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow >= iconSize + 4) {
      // Below the field
      top = rect.bottom + scrollTop + 2;
    } else {
      // Above the field
      top = rect.top + scrollTop - iconSize - 2;
    }
  } else if (isSingleLineInput) {
    // Vertically centered inside single-line inputs
    top = rect.top + scrollTop + (rect.height - iconSize) / 2;
  } else {
    // Bottom-right corner for textareas and other elements
    top = rect.bottom + scrollTop - CONFIG.ICON_OFFSET;
  }

  return {
    left: rect.right + scrollLeft - CONFIG.ICON_OFFSET,
    top,
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
 * Check if a contenteditable contains non-editable interactive UI chrome.
 * This is the general heuristic: all rich text frameworks wrap UI chrome
 * (toolbars, avatars, buttons) in contenteditable="false" islands.
 */
function hasNonEditableInteractiveContent(element: HTMLElement): boolean {
  const nonEditables = element.querySelectorAll('[contenteditable="false"]');
  for (const node of nonEditables) {
    if (
      node.querySelector(
        'button, [role="button"], img, svg, input, select, [data-state], a[href]'
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if element is a complex rich text editor.
 * Uses hybrid detection: known editors by class/attribute, then general heuristic.
 */
export function isComplexEditor(element: HTMLElement): boolean {
  if (element.contentEditable !== 'true' && !element.isContentEditable) return false;

  // Known editors (fast path)
  if (
    element.classList.contains('ProseMirror') ||
    element.classList.contains('tiptap') ||
    element.closest('.ProseMirror, .tiptap')
  ) {
    return true;
  }
  if (
    element.classList.contains('public-DraftEditor-content') ||
    element.closest('.public-DraftEditor-content')
  ) {
    return true;
  }
  if (element.hasAttribute('data-slate-editor') || element.closest('[data-slate-editor]')) {
    return true;
  }
  if (element.classList.contains('ql-editor') || element.closest('.ql-editor')) {
    return true;
  }

  // General fallback: contenteditable with non-editable interactive islands
  return hasNonEditableInteractiveContent(element);
}
