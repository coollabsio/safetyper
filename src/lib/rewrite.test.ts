/**
 * Rewrite prompt and response parsing.
 * Execute with `bun src/lib/rewrite.test.ts`.
 */

import { parseRewrite, rewriteOption, rewritePrompt, REWRITE_OPTIONS } from './rewrite';
import { DEFAULT_WRITING_GOALS } from './goals';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  const labels = REWRITE_OPTIONS.map((option) => option.label);
  assertEqual(
    labels.join('|'),
    'Improve clarity|Shorten|More formal|More friendly|More confident',
    'rewrite menu labels'
  );
  assertEqual(rewriteOption('shorten')?.label, 'Shorten', 'shorten option');
  assertEqual(rewriteOption('nope'), null, 'unknown option');

  const prompt = rewritePrompt(REWRITE_OPTIONS[0], {
    audience: 'expert',
    formality: 'formal',
    domain: 'academic',
    intent: 'convince',
  });
  assert(prompt.includes('{"rewrite"'), 'rewrite schema');
  assert(prompt.includes('Improve clarity'), 'clarity task');
  assert(prompt.includes('expert readers'), 'goals in the rewrite prompt');
  assert(prompt.includes('academic writing'), 'domain in the rewrite prompt');
  assert(!prompt.includes('"issues"'), 'rewrite prompt does not ask for issues');

  assertEqual(
    parseRewrite('{"rewrite":"The team will review it."}'),
    'The team will review it.',
    'json rewrite'
  );
  assertEqual(parseRewrite('```json\n{"rewrite":"Shorter."}\n```'), 'Shorter.', 'fenced rewrite');
  assertEqual(
    parseRewrite('A plain rewritten passage.'),
    'A plain rewritten passage.',
    'plain text'
  );
  assertEqual(parseRewrite('"Quoted passage."'), 'Quoted passage.', 'wrapped quotes');
  assertEqual(parseRewrite('{"issues":[]}'), null, 'issues json is not a rewrite');
  assertEqual(parseRewrite('{"rewrite":""}'), null, 'empty rewrite');
  assertEqual(parseRewrite('{"rewrite": 12}'), null, 'non-string rewrite');
  assertEqual(parseRewrite('   '), null, 'blank reply');

  const withGoals = rewritePrompt(rewriteOption('confident')!, DEFAULT_WRITING_GOALS);
  assert(withGoals.includes('more confident'), 'confident instruction');
  assert(withGoals.includes('Formality: neutral'), 'default goals still appear');

  console.log('rewrite tests passed');
}

run();
