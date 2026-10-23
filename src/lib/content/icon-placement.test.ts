/**
 * Stable corner placement for the grammar icon.
 * Execute with `bun src/lib/content/icon-placement.test.ts`.
 */

import {
  ICON_CORNER_INSET,
  anchorIconPosition,
  iconCornerInset,
  iconPositionMoved,
  iconStaysShown,
  iconTransformValue,
  type FieldBox,
} from './icon-placement';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function field(partial: Partial<FieldBox>): FieldBox {
  return {
    left: 100,
    top: 40,
    width: 320,
    height: 140,
    paddingLeft: 8,
    paddingRight: 16,
    paddingTop: 6,
    paddingBottom: 12,
    rtl: false,
    ...partial,
  };
}

function run(): void {
  const placed = anchorIconPosition(field({}), 24);
  const transform = iconTransformValue(placed);
  assert(transform.startsWith('translate('), 'the first paint writes a transform');
  assert(
    !transform.includes('translate(0px, 0px)'),
    'a field away from the origin is not left at 0,0'
  );
  assert(iconStaysShown(false, false), 'the icon stays shown before intersection is confirmed');
  assert(!iconStaysShown(true, false), 'the icon hides after the field leaves the screen');
  assert(iconStaysShown(true, true), 'the icon shows again when the field returns');
  assertEqual(placed.left, 100 + 320 - 24 - 16, 'sits inside the right padding');
  assertEqual(placed.top, 40 + 140 - 24 - 12, 'sits inside the bottom padding');

  const rtl = anchorIconPosition(field({ rtl: true }), 24);
  assertEqual(rtl.left, 100 + 8, 'rtl uses the left padding');
  assertEqual(rtl.top, placed.top, 'rtl keeps the same bottom edge');

  const minimum = anchorIconPosition(
    field({ paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }),
    24
  );
  assertEqual(minimum.left, 100 + 320 - 24 - ICON_CORNER_INSET, 'empty padding keeps a small gap');
  assertEqual(minimum.top, 40 + 140 - 24 - ICON_CORNER_INSET, 'empty bottom padding keeps a gap');

  const rounded = anchorIconPosition(
    field({
      left: 100.4,
      top: 40.6,
      width: 200.2,
      height: 80.2,
      paddingRight: 8.4,
      paddingBottom: 6.2,
    }),
    24
  );
  assertEqual(rounded.left, Math.round(100.4 + 200.2 - 24 - 8.4), 'horizontal subpixels round');
  assertEqual(rounded.top, Math.round(40.6 + 80.2 - 24 - 6.2), 'vertical subpixels round');
  assertEqual(rounded.left, Math.round(rounded.left), 'left is a whole pixel');
  assertEqual(rounded.top, Math.round(rounded.top), 'top is a whole pixel');

  const again = anchorIconPosition(
    field({
      left: 100.4,
      top: 40.6,
      width: 200.2,
      height: 80.2,
      paddingRight: 8.4,
      paddingBottom: 6.2,
    }),
    24
  );
  assertEqual(again.left, rounded.left, 'the same box anchors twice to the same left');
  assertEqual(again.top, rounded.top, 'the same box anchors twice to the same top');
  assert(!iconPositionMoved(rounded, again), 'an identical anchor is not a move');
  assert(
    !iconPositionMoved(rounded, { left: rounded.left + 0.4, top: rounded.top }),
    'subpixel noise is ignored'
  );
  assert(iconPositionMoved(null, rounded), 'the first position is applied');
  assert(
    iconPositionMoved(rounded, { left: rounded.left + 1, top: rounded.top }),
    'a full pixel is a move'
  );

  const past = anchorIconPosition(
    field({ left: 1100, top: 760, width: 200, height: 80, paddingRight: 4, paddingBottom: 4 }),
    24
  );
  assertEqual(past.left, 1100 + 200 - 24 - 4, 'follows the field past the right edge');
  assertEqual(past.top, 760 + 80 - 24 - 4, 'follows the field past the bottom edge');

  const tiny = anchorIconPosition(
    field({ left: 12, top: 18, width: 20, height: 16, paddingRight: 8, paddingBottom: 8 }),
    24
  );
  assertEqual(iconCornerInset(8, 20 - 24), 0, 'no inset when the icon is larger than the field');
  assertEqual(tiny.left, 12 + 20 - 24, 'a short field pins to its right edge');
  assertEqual(tiny.top, 18 + 16 - 24, 'a short field pins to its bottom edge');

  const scrolled = anchorIconPosition(
    field({ left: 40, top: -80, width: 200, height: 48, paddingRight: 4, paddingBottom: 4 }),
    24
  );
  assertEqual(
    scrolled.top,
    Math.round(-80 + 48 - 24 - 4),
    'follows a field scrolled above the viewport'
  );
  assertEqual(scrolled.left, 40 + 200 - 24 - 4, 'keeps the same horizontal corner while scrolling');
}

run();
console.log('icon placement tests passed');
