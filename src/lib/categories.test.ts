/**
 * Category ids, legacy mapping, and color tokens.
 * Execute with `bun src/lib/categories.test.ts`.
 */

import { DEFAULT_SYSTEM_PROMPT } from './content/config';
import {
  SUGGESTION_GROUP_IDS,
  SUGGESTION_GROUPS,
  SUGGESTION_SUBCATEGORIES,
  classifyIssue,
  countByGroup,
  groupColorStyle,
  groupMembershipRules,
  recognizedGroup,
  subcategoryGroup,
} from './categories';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assertEqual(SUGGESTION_GROUPS.length, 4, 'four groups');
  const labels = SUGGESTION_GROUPS.map((group) => group.label).join(',');
  assertEqual(labels, 'Correctness,Clarity,Engagement,Delivery', 'group labels');

  for (const subcategory of SUGGESTION_SUBCATEGORIES) {
    assertEqual(subcategoryGroup(subcategory.id), subcategory.group, `${subcategory.id} group`);
  }
  assertEqual(subcategoryGroup('spelling'), 'correctness', 'spelling is correctness');
  assertEqual(subcategoryGroup('wordiness'), 'clarity', 'wordiness is clarity');
  assertEqual(subcategoryGroup('vividness'), 'engagement', 'vividness is engagement');
  assertEqual(subcategoryGroup('monotonous'), 'engagement', 'monotonous is engagement');
  assertEqual(subcategoryGroup('politeness'), 'delivery', 'politeness is delivery');

  const modern = classifyIssue({ group: 'engagement', subcategory: 'word-choice' });
  assertEqual(modern.group, 'engagement', 'modern group');
  assertEqual(modern.subcategory, 'word-choice', 'modern subcategory');
  assertEqual(modern.category, 'word-choice', 'category mirrors subcategory');

  const mismatched = classifyIssue({ group: 'correctness', subcategory: 'formality' });
  assertEqual(mismatched.group, 'delivery', 'subcategory wins over a mismatched group');
  assertEqual(mismatched.subcategory, 'formality', 'formality subcategory');

  const spaced = classifyIssue({ subcategory: 'Word choice' });
  assertEqual(spaced.subcategory, 'word-choice', 'spaced word choice');
  assertEqual(spaced.group, 'engagement', 'spaced word choice group');

  const vivid = classifyIssue({ subcategory: 'vivid wording' });
  assertEqual(vivid.subcategory, 'vividness', 'vivid wording alias');

  assertEqual(classifyIssue({ category: 'spelling' }).group, 'correctness', 'legacy spelling');
  assertEqual(classifyIssue({ category: 'grammar' }).subcategory, 'grammar', 'legacy grammar');
  assertEqual(
    classifyIssue({ category: 'punctuation' }).subcategory,
    'punctuation',
    'legacy punctuation'
  );
  assertEqual(classifyIssue({ category: 'clarity' }).group, 'clarity', 'legacy clarity group');
  assertEqual(
    classifyIssue({ category: 'clarity' }).subcategory,
    'readability',
    'legacy clarity becomes readability'
  );
  assertEqual(classifyIssue({ category: 'style' }).group, 'engagement', 'legacy style group');
  assertEqual(
    classifyIssue({ category: 'style' }).subcategory,
    'word-choice',
    'legacy style becomes word choice'
  );
  assertEqual(classifyIssue({ category: 'other' }).subcategory, 'word-choice', 'other maps onward');

  const groupOnly = classifyIssue({ group: 'delivery' });
  assertEqual(groupOnly.subcategory, 'tone', 'delivery without a subcategory uses tone');
  assertEqual(classifyIssue({ group: 'tone' }).group, 'delivery', 'tone is a delivery alias');
  assertEqual(classifyIssue({ category: 'nope' }).subcategory, 'grammar', 'unknown stays grammar');
  assertEqual(classifyIssue({}).group, 'correctness', 'empty stays correctness');
  assertEqual(recognizedGroup({ category: 'style' }), 'engagement', 'legacy style is engagement');
  assertEqual(recognizedGroup({ category: 'unknown' }), null, 'unknown category has no group');
  assertEqual(recognizedGroup({}), null, 'an empty issue has no group');

  const counts = countByGroup([
    { group: 'correctness' },
    { group: 'correctness' },
    { group: 'clarity' },
    { group: 'engagement' },
    { group: 'delivery' },
  ]);
  assertEqual(counts.correctness, 2, 'correctness count');
  assertEqual(counts.clarity, 1, 'clarity count');
  assertEqual(counts.engagement, 1, 'engagement count');
  assertEqual(counts.delivery, 1, 'delivery count');

  for (const theme of ['light', 'dark'] as const) {
    const style = groupColorStyle(theme);
    const accents = SUGGESTION_GROUP_IDS.map((id) => style[`--st-${id}-accent`]);
    assertEqual(new Set(accents).size, 4, `${theme} accents are distinct`);
    for (const id of SUGGESTION_GROUP_IDS) {
      assert(style[`--st-${id}-text`]?.includes('oklch'), `${theme} ${id} text`);
      assert(style[`--st-${id}-surface`]?.includes('oklch'), `${theme} ${id} surface`);
      assert(style[`--st-${id}-accent`]?.includes('oklch'), `${theme} ${id} accent`);
    }
  }

  const rules = groupMembershipRules();
  assert(rules.includes('correctness (spelling, grammar, punctuation)'), 'membership correctness');
  assert(
    rules.includes('delivery (formality, confidence, politeness, tone)'),
    'membership delivery'
  );
  for (const id of SUGGESTION_GROUP_IDS) {
    assert(DEFAULT_SYSTEM_PROMPT.includes(id), `prompt lists ${id}`);
  }
  for (const subcategory of SUGGESTION_SUBCATEGORIES) {
    assert(DEFAULT_SYSTEM_PROMPT.includes(subcategory.id), `prompt lists ${subcategory.id}`);
  }
  assert(DEFAULT_SYSTEM_PROMPT.includes('"group"'), 'prompt asks for group');
  assert(DEFAULT_SYSTEM_PROMPT.includes('"subcategory"'), 'prompt asks for subcategory');

  console.log('category tests passed');
}

run();
