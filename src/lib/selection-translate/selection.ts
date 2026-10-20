/**
 * Read and replace the selection in the page, including form fields.
 * Input and textarea selections are not visible to window.getSelection().
 */

import type { AnchorBox } from './position';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', '']);

export interface InputEditable {
  kind: 'input';
  element: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
}

export interface RichEditable {
  kind: 'rich';
  range: Range;
}

export type EditableTarget = InputEditable | RichEditable;

export interface PageSelection {
  text: string;
  rect: AnchorBox;
  editable: EditableTarget | null;
  at: number;
}

export function readPageSelection(): PageSelection | null {
  const active = document.activeElement;
  if (isTextField(active)) {
    return readFieldSelection(active);
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString();
  if (!text.trim()) return null;

  const range = selection.getRangeAt(0);
  if (isTranslateBubbleNode(range.commonAncestorContainer)) return null;

  const editable = readRichEditable(range);
  const domRect = range.getBoundingClientRect();
  const rect =
    domRect.width > 0 || domRect.height > 0
      ? toAnchor(domRect)
      : toAnchor(range.startContainer.parentElement?.getBoundingClientRect());

  return { text, rect, editable, at: Date.now() };
}

export function currentRect(selection: PageSelection): AnchorBox {
  const editable = selection.editable;
  if (editable?.kind === 'input' && editable.element.isConnected) {
    return clampToElement(caretRect(editable.element, editable.end), editable.element);
  }
  if (editable?.kind === 'rich' && editable.range.startContainer.isConnected) {
    const rect = editable.range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return toAnchor(rect);
  }
  return selection.rect;
}

export function replaceEditableText(target: EditableTarget, replacement: string): boolean {
  if (target.kind === 'input') {
    const element = target.element;
    if (!element.isConnected || !canReplaceField(element)) return false;
    const start = clampOffset(target.start, element.value.length);
    const end = clampOffset(Math.max(target.end, start), element.value.length);
    element.focus();
    element.setRangeText(replacement, start, end, 'select');
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: replacement,
      })
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const range = target.range;
  if (!range.startContainer.isConnected) return false;
  range.deleteContents();
  const node = document.createTextNode(replacement);
  range.insertNode(node);
  const selection = window.getSelection();
  if (selection) {
    const next = document.createRange();
    next.setStartAfter(node);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
  }
  node.parentElement?.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: replacement,
    })
  );
  return true;
}

export function isTranslateBubbleNode(node: Node | null): boolean {
  if (!node) return false;
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest('[data-safetyper-translate]')) return true;
  const root = node.getRootNode();
  return root instanceof ShadowRoot && root.host.matches('[data-safetyper-translate]');
}

/** Chrome's context-menu selection collapses whitespace. Compare on that form. */
export function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readFieldSelection(element: HTMLInputElement | HTMLTextAreaElement): PageSelection | null {
  if (element instanceof HTMLInputElement && element.type === 'password') return null;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  if (start === null || end === null || start === end) return null;
  const text = element.value.slice(start, end);
  if (!text.trim()) return null;
  const rect = clampToElement(caretRect(element, end), element);
  const editable = canReplaceField(element)
    ? { kind: 'input' as const, element, start, end }
    : null;
  return { text, rect, editable, at: Date.now() };
}

function readRichEditable(range: Range): RichEditable | null {
  let element =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  while (element) {
    if (element instanceof HTMLElement && element.isContentEditable) {
      return { kind: 'rich', range: range.cloneRange() };
    }
    element = element.parentElement;
  }
  return null;
}

function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type);
}

function canReplaceField(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  return !element.readOnly && !element.disabled && isTextField(element);
}

function caretRect(element: HTMLInputElement | HTMLTextAreaElement, index: number): AnchorBox {
  const style = window.getComputedStyle(element);
  const mirror = document.createElement('div');
  const properties = [
    'direction',
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontFamily',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'textAlign',
    'textIndent',
    'whiteSpace',
    'wordSpacing',
    'wordBreak',
    'overflowWrap',
  ] as const;

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = element instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  for (const property of properties) {
    mirror.style[property] = style[property];
  }

  mirror.textContent = element.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = element.value.slice(index, index + 1) || ' ';
  mirror.append(marker);
  document.body.append(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  mirror.remove();

  const height = markerRect.height || Number.parseFloat(style.lineHeight) || 20;
  return {
    left: elementRect.left + (markerRect.left - mirrorRect.left) - element.scrollLeft,
    top: elementRect.top + (markerRect.top - mirrorRect.top) - element.scrollTop,
    width: Math.max(markerRect.width, 2),
    height,
  };
}

function clampToElement(rect: AnchorBox, element: HTMLElement): AnchorBox {
  const bounds = element.getBoundingClientRect();
  return {
    left: clamp(rect.left, bounds.left, Math.max(bounds.left, bounds.right - 2)),
    top: clamp(rect.top, bounds.top, Math.max(bounds.top, bounds.bottom - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

function toAnchor(rect: DOMRect | undefined): AnchorBox {
  if (!rect) return { left: 16, top: 16, width: 0, height: 0 };
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function clampOffset(value: number, length: number): number {
  return Math.min(length, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
