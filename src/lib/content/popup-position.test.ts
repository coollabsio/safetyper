/**
 * Card placement under a flagged span.
 * Execute with `bun src/lib/content/popup-position.test.ts`.
 */

import { placePopupNearRect } from './popup-position';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  const under = placePopupNearRect(
    { left: 40, top: 100, width: 80, height: 18 },
    { width: 320, height: 180 },
    { width: 1000, height: 800 }
  );
  assertEqual(under.left, 40, 'card lines up with the quote');
  assertEqual(under.top, 126, 'card sits just under the quote');

  const flipped = placePopupNearRect(
    { left: 40, top: 700, width: 80, height: 18 },
    { width: 320, height: 180 },
    { width: 1000, height: 800 }
  );
  assertEqual(flipped.top, 512, 'card flips above when there is no room below');

  const clamped = placePopupNearRect(
    { left: 900, top: 40, width: 80, height: 18 },
    { width: 320, height: 120 },
    { width: 1000, height: 800 }
  );
  assertEqual(clamped.left, 672, 'card stays inside the viewport');
  assertEqual(clamped.top, 66, 'card still prefers below the quote');
}

run();
console.log('popup position tests passed');
