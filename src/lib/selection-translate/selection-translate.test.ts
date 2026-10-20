/**
 * Runnable checks for the selection-translate menu, placement, and popup handoff.
 * Execute with `bun src/lib/selection-translate/selection-translate.test.ts`.
 */

import { isTranslateHandoff } from './handoff';
import { CHANGE_LANGUAGE_TITLE, TRANSLATE_PARENT_TITLE, translateTargetMenuTitle } from './menu';
import { placeBubble } from './position';
import { normalizeSelectionText } from './selection';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assertEqual(TRANSLATE_PARENT_TITLE, 'Translate with SafeTyper', 'parent menu title');
  assertEqual(CHANGE_LANGUAGE_TITLE, 'Change language…', 'change language title');
  assertEqual(translateTargetMenuTitle('Spanish'), 'Translate to Spanish', 'target title');
  assertEqual(translateTargetMenuTitle('A & B'), 'Translate to A && B', 'ampersand is escaped');

  const room = placeBubble(
    { left: 40, top: 40, width: 100, height: 20 },
    { width: 320, height: 180 },
    { width: 800, height: 600 }
  );
  assertEqual(room.left, 40, 'places at the selection left');
  assertEqual(room.top, 68, 'places below the selection');

  const low = placeBubble(
    { left: 40, top: 500, width: 100, height: 20 },
    { width: 320, height: 180 },
    { width: 800, height: 600 }
  );
  assertEqual(low.top, 312, 'flips above the selection near the bottom');

  const right = placeBubble(
    { left: 700, top: 40, width: 80, height: 20 },
    { width: 320, height: 180 },
    { width: 800, height: 600 }
  );
  assertEqual(right.left, 460, 'shifts left when the bubble would overflow');

  const edge = placeBubble(
    { left: -40, top: -40, width: 10, height: 10 },
    { width: 320, height: 180 },
    { width: 800, height: 600 }
  );
  assertEqual(edge.left, 8, 'clamps to the left margin');
  assertEqual(edge.top, 8, 'clamps to the top margin');

  assertEqual(normalizeSelectionText('Hello\nworld'), 'Hello world', 'newlines collapse');
  assertEqual(normalizeSelectionText('  Hello   world  '), 'Hello world', 'spaces collapse');

  assert(
    isTranslateHandoff({ text: 'Hello', at: 10, translation: 'Hola', detected: 'English' }),
    'handoff with a translation'
  );
  assert(isTranslateHandoff({ text: '', at: 1 }), 'empty handoff text is still a handoff');
  assert(!isTranslateHandoff({ text: 'Hello' }), 'handoff needs a timestamp');
  assert(!isTranslateHandoff(null), 'null is not a handoff');
  assert(!isTranslateHandoff({ text: 'Hello', at: '10' }), 'timestamp must be a number');
}

run();
