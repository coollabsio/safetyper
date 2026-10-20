/**
 * Writing-goal parsing and prompt text.
 * Execute with `bun src/lib/goals.test.ts`.
 */

import {
  DEFAULT_WRITING_GOALS,
  composeSystemPrompt,
  parseWritingGoals,
  writingGoalsInstructions,
} from './goals';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assertEqual(DEFAULT_WRITING_GOALS.audience, 'general', 'default audience');
  assertEqual(DEFAULT_WRITING_GOALS.formality, 'neutral', 'default formality');
  assertEqual(DEFAULT_WRITING_GOALS.domain, 'general', 'default domain');
  assertEqual(DEFAULT_WRITING_GOALS.intent, 'inform', 'default intent');

  const parsed = parseWritingGoals({
    audience: 'expert',
    formality: 'formal',
    domain: 'academic',
    intent: 'tell-a-story',
    extra: true,
  });
  assertEqual(parsed.audience, 'expert', 'audience kept');
  assertEqual(parsed.formality, 'formal', 'formality kept');
  assertEqual(parsed.domain, 'academic', 'domain kept');
  assertEqual(parsed.intent, 'tell-a-story', 'intent kept');

  const partial = parseWritingGoals({ audience: 'knowledgeable', domain: 'nope' });
  assertEqual(partial.audience, 'knowledgeable', 'partial audience');
  assertEqual(partial.domain, 'general', 'bad domain falls back');
  assertEqual(partial.formality, 'neutral', 'missing formality falls back');
  assertEqual(parseWritingGoals(null).intent, 'inform', 'null uses defaults');

  const instructions = writingGoalsInstructions({
    audience: 'expert',
    formality: 'formal',
    domain: 'email',
    intent: 'convince',
  });
  assert(instructions.includes('expert readers'), 'audience detail');
  assert(instructions.includes('Formality: formal'), 'formality line');
  assert(instructions.includes('an email'), 'domain detail');
  assert(instructions.includes('convince the reader'), 'intent detail');

  const composed = composeSystemPrompt('BASE', {
    audience: 'knowledgeable',
    formality: 'informal',
    domain: 'business',
    intent: 'describe',
  });
  assert(composed.startsWith('BASE\n'), 'base stays first');
  assert(composed.includes('knowledgeable readers'), 'goals appended');
  assert(composed.includes('business writing'), 'domain appended');
  assert(composed.includes('describe something'), 'intent appended');
  assertEqual(
    composeSystemPrompt('  ', DEFAULT_WRITING_GOALS).includes('Writing goals'),
    true,
    'empty base'
  );

  console.log('goals tests passed');
}

run();
