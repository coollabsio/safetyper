/**
 * Choose a viewport position for the grammar icon that avoids in-field controls.
 * The icon is position:fixed, so every coordinate here is viewport space.
 */

import type { Position } from './types';
import { iconPixelSize } from './icon-metrics';

const GAP = 3;
const INSET = 4;
/** The 12px badge hangs 8px off the disc. Inside placements leave that much room. */
const BADGE_HANG = 11;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const PASSWORD_MANAGER =
  /onepassword|1password|bitwarden|lastpass|dashlane|proton-?pass|keeper|roboform/i;

const PASSWORD_MANAGER_SELECTOR = [
  '[data-lastpass-icon-root]',
  '[data-lastpass-root]',
  '[data-com-onepassword-filled]',
  'com-1password-button',
  'com-bitwarden-button',
  '[data-bwautofill]',
  '[data-dashlane-rid]',
  '[data-dashlanecreated]',
  'protonpass-control',
  '[data-protonpass-root]',
  '[data-protonpass-control]',
  '[data-keeper-lock]',
].join(',');

function iconBox(position: Position): Box {
  return {
    left: position.left,
    top: position.top,
    right: position.left + iconPixelSize(),
    bottom: position.top + iconPixelSize(),
  };
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right + GAP &&
    a.right > b.left - GAP &&
    a.top < b.bottom + GAP &&
    a.bottom > b.top - GAP
  );
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function isOurUi(element: HTMLElement): boolean {
  return Boolean(element.closest('.safetyper-icon, .safetyper-popup, .safetyper-popup-host'));
}

function isSmall(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.width <= 72 && rect.height <= 48;
}

function looksLikeControl(element: HTMLElement, field: HTMLElement): boolean {
  if (element === field || isOurUi(element) || element.contains(field)) return false;
  if (element === document.body || element === document.documentElement) return false;

  const tag = element.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'IMG' || tag === 'SVG') return true;
  if (element.getAttribute('role') === 'button') return true;
  if (tag === 'INPUT' && element !== field) return true;

  const label = `${element.id} ${element.className}`;
  if (PASSWORD_MANAGER.test(label)) return true;
  if (element.matches(PASSWORD_MANAGER_SELECTOR)) return true;

  const style = window.getComputedStyle(element);
  if (style.pointerEvents === 'none' || style.visibility === 'hidden' || style.display === 'none') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (!isSmall(rect)) return false;
  if (style.position === 'absolute' || style.position === 'fixed') return true;
  if (style.backgroundImage && style.backgroundImage !== 'none') return true;
  return false;
}

function pushRect(rects: Box[], rect: DOMRect): void {
  if (rect.width < 2 || rect.height < 2) return;
  rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
}

function eachElement(root: ParentNode, visit: (element: HTMLElement) => void, depth = 0): void {
  if (depth > 4) return;
  root.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    visit(node);
    if (node.shadowRoot) eachElement(node.shadowRoot, visit, depth + 1);
  });
}

function collectObstacles(field: HTMLElement, fieldRect: DOMRect): Box[] {
  const obstacles: Box[] = [];
  const scopes: ParentNode[] = [field];
  const parent = field.parentElement;
  if (parent && parent !== document.body && parent.childElementCount <= 40) scopes.push(parent);
  const grand = parent?.parentElement;
  if (
    grand &&
    grand !== document.body &&
    grand !== document.documentElement &&
    grand.childElementCount <= 40
  ) {
    scopes.push(grand);
  }

  for (const scope of scopes) {
    eachElement(scope, (element) => {
      if (!looksLikeControl(element, field)) return;
      const rect = element.getBoundingClientRect();
      const near =
        rect.left < fieldRect.right + iconPixelSize() + 12 &&
        rect.right > fieldRect.left - iconPixelSize() - 12 &&
        rect.top < fieldRect.bottom + iconPixelSize() + 12 &&
        rect.bottom > fieldRect.top - iconPixelSize() - 12;
      if (near) pushRect(obstacles, rect);
    });
  }

  const style = window.getComputedStyle(field);
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  if (paddingRight >= 28) {
    obstacles.push({
      left: fieldRect.right - paddingRight,
      top: fieldRect.top,
      right: fieldRect.right,
      bottom: fieldRect.bottom,
    });
  }
  if (paddingLeft >= 28) {
    obstacles.push({
      left: fieldRect.left,
      top: fieldRect.top,
      right: fieldRect.left + paddingLeft,
      bottom: fieldRect.bottom,
    });
  }
  if (style.backgroundImage && style.backgroundImage !== 'none') {
    const positionX = style.backgroundPositionX;
    if (positionX.includes('right') || positionX === '100%') {
      obstacles.push({
        left: fieldRect.right - 28,
        top: fieldRect.top,
        right: fieldRect.right,
        bottom: fieldRect.bottom,
      });
    }
    if (positionX.includes('left') || positionX === '0%' || positionX === '0px') {
      obstacles.push({
        left: fieldRect.left,
        top: fieldRect.top,
        right: fieldRect.left + 28,
        bottom: fieldRect.bottom,
      });
    }
  }

  const samples: Array<[number, number]> = [
    [fieldRect.right - 12, fieldRect.top + fieldRect.height / 2],
    [fieldRect.right - 12, fieldRect.bottom - 12],
    [fieldRect.right - 12, fieldRect.top + 12],
    [fieldRect.left + 12, fieldRect.top + fieldRect.height / 2],
    [fieldRect.right + 16, fieldRect.top + fieldRect.height / 2],
    [fieldRect.left - 16, fieldRect.top + fieldRect.height / 2],
  ];
  for (const [x, y] of samples) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (!(hit instanceof HTMLElement)) continue;
      if (hit === field || hit.contains(field) || isOurUi(hit)) continue;
      if (!looksLikeControl(hit, field)) continue;
      pushRect(obstacles, hit.getBoundingClientRect());
      break;
    }
  }

  return obstacles;
}

function isMultiline(field: HTMLElement, rect: DOMRect): boolean {
  if (field.tagName === 'TEXTAREA' || field.isContentEditable) return true;
  return rect.height > iconPixelSize() + 20;
}

function isRtl(field: HTMLElement): boolean {
  return window.getComputedStyle(field).direction === 'rtl';
}

function vertical(rect: DOMRect, align: 'center' | 'top' | 'bottom'): number {
  if (align === 'center') return rect.top + (rect.height - iconPixelSize()) / 2;
  if (align === 'top') return rect.top + INSET + BADGE_HANG;
  return rect.bottom - iconPixelSize() - INSET;
}

function buildCandidates(field: HTMLElement, rect: DOMRect): Position[] {
  const rtl = isRtl(field);
  const multiline = isMultiline(field, rect);
  const tooShort = rect.height < iconPixelSize() + 6;
  const end = rtl ? 'left' : 'right';
  const start = rtl ? 'right' : 'left';

  const inside = (side: 'left' | 'right', align: 'center' | 'top' | 'bottom'): Position => ({
    left: side === 'right' ? rect.right - iconPixelSize() - INSET - BADGE_HANG : rect.left + INSET,
    top: vertical(rect, align),
  });
  const outside = (side: 'left' | 'right', align: 'center' | 'top' | 'bottom'): Position => ({
    left: side === 'right' ? rect.right + INSET : rect.left - iconPixelSize() - INSET,
    top: vertical(rect, align),
  });
  const edge = (side: 'left' | 'right', place: 'below' | 'above'): Position => ({
    left: side === 'right' ? rect.right - iconPixelSize() : rect.left,
    top: place === 'below' ? rect.bottom + INSET : rect.top - iconPixelSize() - INSET,
  });

  const align = multiline ? 'bottom' : 'center';
  const candidates: Position[] = [];
  // Stay on the end side first, including just outside the field, before covering
  // the text on the opposite edge.
  if (!tooShort) {
    candidates.push(inside(end, align));
    if (multiline) candidates.push(inside(end, 'top'));
  }
  candidates.push(outside(end, align), outside(start, align));
  candidates.push(
    edge(end, 'below'),
    edge(end, 'above'),
    edge(start, 'below'),
    edge(start, 'above')
  );
  if (!tooShort) {
    candidates.push(inside(start, align));
    if (multiline) candidates.push(inside(start, 'top'));
  }
  return candidates;
}

/** Opaque backdrop luminance at the icon center, or null when the backdrop is clear. */
export function backdropLuminance(position: Position): number | null {
  const x = position.left + iconPixelSize() / 2;
  const y = position.top + iconPixelSize() / 2;
  const hit = document
    .elementsFromPoint(x, y)
    .find((element) => element instanceof HTMLElement && !isOurUi(element));
  let node = hit instanceof HTMLElement ? hit : null;
  while (node) {
    const background = window.getComputedStyle(node).backgroundColor;
    const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (alpha > 0.4) {
        return (
          (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
        );
      }
    }
    node = node.parentElement;
  }
  return null;
}

function backdropIsUsable(position: Position): boolean {
  const luminance = backdropLuminance(position);
  return luminance === null || luminance > 0.25;
}

function inViewport(box: Box): boolean {
  return (
    box.left >= 2 &&
    box.top >= 2 &&
    box.right <= window.innerWidth - 2 &&
    box.bottom <= window.innerHeight - 2
  );
}

function pointHitsObstacle(position: Position, field: HTMLElement): boolean {
  const points: Array<[number, number]> = [
    [position.left + iconPixelSize() / 2, position.top + iconPixelSize() / 2],
    [position.left + 4, position.top + 4],
    [position.left + iconPixelSize() - 4, position.top + iconPixelSize() - 4],
  ];
  for (const [x, y] of points) {
    for (const hit of document.elementsFromPoint(x, y)) {
      if (!(hit instanceof HTMLElement)) continue;
      if (hit === field || hit.contains(field) || isOurUi(hit)) continue;
      if (looksLikeControl(hit, field)) return true;
    }
  }
  return false;
}

function clampToViewport(position: Position): Position {
  return {
    left: Math.min(Math.max(2, position.left), window.innerWidth - iconPixelSize() - 2),
    top: Math.min(Math.max(2, position.top), window.innerHeight - iconPixelSize() - 2),
  };
}

/**
 * Pick the first candidate that stays on screen and misses nearby controls.
 * If every spot overlaps something, use the one with the smallest overlap.
 */
export function calculateSmartIconPosition(field: HTMLElement): Position {
  const rect = field.getBoundingClientRect();
  const obstacles = collectObstacles(field, rect);
  const candidates = buildCandidates(field, rect);
  let best: Position | null = null;
  let bestOverlap = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const box = iconBox(candidate);
    if (!inViewport(box)) continue;
    const overlap = obstacles.reduce((sum, obstacle) => sum + overlapArea(box, obstacle), 0);
    const blocked =
      overlap > 0 || pointHitsObstacle(candidate, field) || !backdropIsUsable(candidate);
    if (!blocked) return candidate;
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
  }

  return clampToViewport(best ?? candidates[0]);
}

/**
 * Nudge a selection icon off any control that shares its box.
 */
export function avoidObstacles(position: Position, field: HTMLElement | null): Position {
  if (!field) return clampToViewport(position);
  const obstacles = collectObstacles(field, field.getBoundingClientRect());
  const shifts = [0, -iconPixelSize() - GAP, iconPixelSize() + GAP];
  for (const dx of shifts) {
    for (const dy of shifts) {
      const next = { left: position.left + dx, top: position.top + dy };
      const box = iconBox(next);
      if (!inViewport(box)) continue;
      if (
        obstacles.every((obstacle) => !intersects(box, obstacle)) &&
        !pointHitsObstacle(next, field)
      ) {
        return next;
      }
    }
  }
  return clampToViewport(position);
}
