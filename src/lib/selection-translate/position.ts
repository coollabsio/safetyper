/**
 * Keep the translation bubble next to the selection and inside the viewport.
 */

export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BubbleSize {
  width: number;
  height: number;
}

export function placeBubble(
  anchor: AnchorBox,
  bubble: BubbleSize,
  viewport: BubbleSize,
  gap = 8,
  margin = 8
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - bubble.width - margin);
  const maxTop = Math.max(margin, viewport.height - bubble.height - margin);

  let left = anchor.left;
  if (left + bubble.width > viewport.width - margin) {
    left = anchor.left + anchor.width - bubble.width;
  }

  let top = anchor.top + anchor.height + gap;
  if (top + bubble.height > viewport.height - margin) {
    top = anchor.top - bubble.height - gap;
  }

  return {
    left: clamp(left, margin, maxLeft),
    top: clamp(top, margin, maxTop),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
