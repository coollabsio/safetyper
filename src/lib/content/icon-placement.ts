/**
 * Anchor the grammar icon to a field's border box.
 * The math is pure: it does not read the selection, focus anything, or touch the DOM.
 * Callers pass a rectangle and cached padding, then move the icon only when the
 * rounded pixel position changes.
 */

import type { Position } from './types';

/** Minimum gap between the icon and the field's border when padding is smaller. */
export const ICON_CORNER_INSET = 4;

export interface FieldBox {
  left: number;
  top: number;
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  rtl: boolean;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** How far inside the border the icon sits on one axis. Never past the field's own room. */
export function iconCornerInset(padding: number, room: number): number {
  const available = finite(room);
  if (available <= 0) return 0;
  const preferred = Math.max(ICON_CORNER_INSET, finite(padding));
  return Math.min(preferred, available);
}

/**
 * Bottom-end corner inside the field's padding.
 * LTR uses the right edge. RTL uses the left edge. Values are whole pixels.
 */
export function anchorIconPosition(field: FieldBox, iconSize: number): Position {
  const size = Math.max(0, finite(iconSize));
  const width = Math.max(0, finite(field.width));
  const height = Math.max(0, finite(field.height));
  const insetX = iconCornerInset(field.rtl ? field.paddingLeft : field.paddingRight, width - size);
  const insetY = iconCornerInset(field.paddingBottom, height - size);
  const left = field.rtl ? finite(field.left) + insetX : finite(field.left) + width - size - insetX;
  const top = finite(field.top) + height - size - insetY;
  return { left: Math.round(left), top: Math.round(top) };
}

/** Ignore sub-pixel noise. A null previous position always counts as a move. */
export function iconPositionMoved(previous: Position | null, next: Position): boolean {
  if (!previous) return true;
  return Math.abs(previous.left - next.left) >= 1 || Math.abs(previous.top - next.top) >= 1;
}

export function iconTransformValue(position: Position): string {
  return `translate(${position.left}px, ${position.top}px)`;
}

/**
 * The first intersection observation is often a false "off screen" before layout.
 * Hide only after the field has actually been seen on screen.
 */
export function iconStaysShown(seenOnScreen: boolean, intersecting: boolean): boolean {
  if (!seenOnScreen) return true;
  return intersecting;
}
