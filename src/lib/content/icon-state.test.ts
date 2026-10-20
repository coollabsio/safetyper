/**
 * Icon state, group priority, and size. Execute with `bun src/lib/content/icon-state.test.ts`.
 */

import { GROUP_COLORS, GROUP_PRIORITY, highestPriorityGroup } from './group-colors';
import { ICON_PIXELS, iconIsHidden, iconPixelSize, setIconSizeSetting } from './icon-metrics';
import { iconAriaLabel, presentIcon, suggestionTooltip } from './icon-state';

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

  const counted = presentIcon({
    activity: 'issues',
    count: 3,
    autoCheck: true,
    group: 'correctness',
  });
  assert(counted.countAsIcon, 'automatic checking turns the icon into the count');
  assertEqual(counted.group, 'correctness', 'count keeps the group');
  assertEqual(suggestionTooltip(3), '3 suggestions', 'tooltip plural');
  assertEqual(suggestionTooltip(1), '1 suggestion', 'tooltip singular');

  const badge = presentIcon({
    activity: 'issues',
    count: 2,
    autoCheck: false,
    group: 'clarity',
  });
  assert(!badge.countAsIcon, 'manual checks keep a separate badge');
  assertEqual(iconAriaLabel('issues', 2), 'SafeTyper, 2 suggestions', 'label includes the count');
  assertEqual(iconAriaLabel('clean', 0), 'SafeTyper, no issues', 'clean label');
  assertEqual(iconAriaLabel('idle', 0), 'Check grammar with SafeTyper', 'idle label');

  const hidden = presentIcon({ activity: 'issues', count: 0, autoCheck: true, group: null });
  assertEqual(hidden.activity, 'idle', 'a zero count is not an issue state');
  assert(!hidden.countAsIcon, 'zero issues hide the count');

  setIconSizeSetting('medium');
  assertEqual(iconPixelSize(), ICON_PIXELS.medium, 'medium is 28px');
  assertEqual(ICON_PIXELS.small, 16, 'small disc is the 16px asset');
  setIconSizeSetting('hidden');
  assert(iconIsHidden(), 'hidden setting');
  assertEqual(iconPixelSize(), ICON_PIXELS.small, 'hidden placement still uses the small box');
  setIconSizeSetting('nope');
  assertEqual(iconPixelSize(), ICON_PIXELS.small, 'unknown size falls back to small');

  console.log('icon state tests passed');
}

run();
