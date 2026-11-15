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

export const BOTTOM_SHEET_MAX_WIDTH = 720;

/** Share of the visual viewport the sheet keeps, so the list can scroll inside it. */
export const BOTTOM_SHEET_HEIGHT_RATIO = 0.62;

export interface VisualViewportBox {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function usesBottomSheet(viewportWidth: number): boolean {
  return viewportWidth <= BOTTOM_SHEET_MAX_WIDTH;
}

/**
 * Dock a stable sheet to the bottom of the visual viewport.
 * The rect does not depend on how many findings are inside, so dismissing one
 * cannot move or resize the panel.
 */
export function placeBottomSheet(
  visual: VisualViewportBox,
  safe: SafeInsets,
  ratio = BOTTOM_SHEET_HEIGHT_RATIO
): { left: number; top: number; width: number; height: number } {
  const left = visual.offsetLeft + safe.left;
  const width = Math.max(0, visual.width - safe.left - safe.right);
  const available = Math.max(0, visual.height - safe.top - safe.bottom);
  const preferred = Math.round(visual.height * ratio);
  const height = Math.min(available, Math.max(Math.min(available, 160), preferred));
  const top = visual.offsetTop + safe.top + (available - height);
  return { left, top, width, height };
}

/**
 * Keep the editor card inside the viewport. The preferred point is where the
 * card would sit under the quote. Clamping uses the card's border box.
 */
/**
 * The box must not get smaller when a loading line replaces a prompt or a list.
 * A taller result may grow it. The top-left stays where the caller left it.
 */
export function lockedPopupBox(
  previous: { width: number; height: number },
  next: { width: number; height: number }
): { width: number; height: number } {
  return {
    width: Math.max(previous.width, next.width),
    height: Math.max(previous.height, next.height),
  };
}

export function placeEditorCard(input: {
  preferredLeft: number;
  preferredTop: number;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}): { left: number; top: number } {
  const margin = input.margin ?? 12;
  const maxLeft = Math.max(margin, input.viewportWidth - input.cardWidth - margin);
  const maxTop = Math.max(margin, input.viewportHeight - input.cardHeight - margin);
  return {
    left: Math.min(Math.max(input.preferredLeft, margin), maxLeft),
    top: Math.min(Math.max(input.preferredTop, margin), maxTop),
  };
}
