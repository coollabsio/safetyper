/**
 * Place a suggestion card against a text rectangle.
 * Prefer directly under the quote. Flip above when the card would leave the viewport.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function placePopupNearRect(
  anchor: RectLike,
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8
): { left: number; top: number } {
  const margin = 8;
  let left = anchor.left;
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - popup.height;
  const fitsBelow = below + popup.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  let top = below;
  if (!fitsBelow && fitsAbove) top = above;
  else if (!fitsBelow && !fitsAbove) {
    top = Math.max(margin, viewport.height - popup.height - margin);
  }
  if (left + popup.width > viewport.width - margin) {
    left = viewport.width - popup.width - margin;
  }
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  return { left, top };
}
