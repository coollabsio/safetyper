/**
 * Icon size and suggestion-group colors for the count badge.
 * Execute with `bun src/lib/content/icon-state.test.ts`.
 */

import { GROUP_COLORS, GROUP_PRIORITY, highestPriorityGroup } from './group-colors';
import { ICON_PIXELS, iconIsHidden, iconPixelSize, setIconSizeSetting } from './icon-metrics';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assertEqual(GROUP_PRIORITY[0], 'correctness', 'correctness outranks the other groups');
  assert(GROUP_COLORS.clarity.light.includes('255'), 'clarity stays blue');
  assert(GROUP_COLORS.delivery.light.includes('310'), 'delivery stays purple');
  assert(GROUP_COLORS.engagement.light.includes('155'), 'engagement stays green');
  assert(GROUP_COLORS.correctness.light.includes('25'), 'correctness stays red');

  assertEqual(
    highestPriorityGroup([{ category: 'style' }, { category: 'clarity' }, { group: 'delivery' }]),
    'clarity',
    'clarity beats engagement and delivery'
  );
  assertEqual(
    highestPriorityGroup([{ category: 'spelling' }, { category: 'clarity' }]),
    'correctness',
    'spelling is correctness and wins'
  );
  assertEqual(
    highestPriorityGroup([{ category: 'unknown' }]),
    null,
    'unknown category has no group'
  );

  assertEqual(ICON_PIXELS.medium, 24, 'medium is the original disc');
  assertEqual(ICON_PIXELS.small, 18, 'small is three quarters of medium');
  setIconSizeSetting('medium');
  assertEqual(iconPixelSize(), 24, 'default placement size is 24');
  setIconSizeSetting('small');
  assertEqual(iconPixelSize(), 18, 'small placement size');
  setIconSizeSetting('hidden');
  assert(iconIsHidden(), 'hidden setting');
  assertEqual(iconPixelSize(), 24, 'hidden placement still uses the original disc');
  setIconSizeSetting('nope');
  assertEqual(iconPixelSize(), 24, 'unknown size falls back to medium');

  console.log('icon state tests passed');
}

run();
