/**
 * Card placement under a flagged span.
 * Execute with `bun src/lib/content/popup-position.test.ts`.
 */

import { readFileSync } from 'node:fs';
import {
  placeBottomSheet,
  placeEditorCard,
  placePopupNearRect,
  usesBottomSheet,
} from './popup-position';

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

  assertEqual(usesBottomSheet(390), true, 'a phone width docks the sheet');
  assertEqual(usesBottomSheet(360), true, 'a narrow android width docks the sheet');
  assertEqual(usesBottomSheet(1280), false, 'a desktop width keeps the quote card');

  const sheet = placeBottomSheet(
    { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 },
    { top: 0, right: 0, bottom: 34, left: 0 }
  );
  assertEqual(sheet.left, 0, 'sheet starts at the visual left');
  assertEqual(sheet.width, 390, 'sheet spans the visual width');
  assertEqual(sheet.top + sheet.height, 844 - 34, 'sheet sits on the safe bottom');
  const again = placeBottomSheet(
    { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 },
    { top: 0, right: 0, bottom: 34, left: 0 }
  );
  assertEqual(again.top, sheet.top, 'a second layout does not move the sheet');
  assertEqual(again.height, sheet.height, 'a second layout does not resize the sheet');

  const keyboard = placeBottomSheet(
    { width: 390, height: 420, offsetLeft: 0, offsetTop: 380 },
    { top: 0, right: 0, bottom: 0, left: 0 }
  );
  assertEqual(keyboard.top + keyboard.height, 380 + 420, 'sheet follows the visual viewport');
  assertEqual(keyboard.top >= 380, true, 'sheet stays inside the visible band');

  const editor = placeEditorCard({
    preferredLeft: 58,
    preferredTop: 269,
    cardWidth: 348,
    cardHeight: 133,
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assertEqual(editor.left, 30, 'editor card moves left so its right edge stays inside');
  assertEqual(editor.left + 348 <= 390 - 12, true, 'editor card clears the right margin');

  assertStruckContrast();
}

function channel(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function contrast(hex: string, background: [number, number, number]): number {
  const linear = (channel: number) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb: [number, number, number]) =>
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  const fg = channel(hex);
  const light = luminance(fg);
  const dark = luminance(background);
  const high = Math.max(light, dark);
  const low = Math.min(light, dark);
  return (high + 0.05) / (low + 0.05);
}

function colorOf(css: string, pattern: RegExp, message: string): string {
  const match = css.match(pattern);
  if (!match) throw new Error(message);
  return match[1];
}

function assertStruckContrast(): void {
  const popup = readFileSync(new URL('../../styles/popup-widget.css', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../../entrypoints/editor/app.css', import.meta.url), 'utf8');
  const light = colorOf(
    popup,
    /\.st-quote del\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/,
    'popup light struck color'
  );
  const dark = colorOf(
    popup,
    /\.st-root\[data-theme='dark'\] \.st-quote del\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/,
    'popup dark struck color'
  );
  const editorLight = colorOf(
    editor,
    /\.quote-line del\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/,
    'editor light struck color'
  );
  const editorDark = colorOf(
    editor,
    /:root\[data-theme='dark'\] \.quote-line del\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/,
    'editor dark struck color'
  );
  assertEqual(contrast(light, [255, 255, 255]) >= 4.5, true, 'struck text clears 4.5:1 on white');
  assertEqual(
    contrast(dark, [51, 51, 51]) >= 4.5,
    true,
    'struck text clears 4.5:1 on the dark card'
  );
  assertEqual(
    contrast(editorLight, [255, 255, 255]) >= 4.5,
    true,
    'editor struck text clears 4.5:1 on white'
  );
  assertEqual(
    contrast(editorDark, [51, 51, 51]) >= 4.5,
    true,
    'editor struck text clears 4.5:1 on a dark card'
  );
}

run();
console.log('popup position tests passed');
