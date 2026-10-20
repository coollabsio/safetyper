/**
 * Runnable checks for suggestion parsing, diff cards, and applying edits.
 * Execute with `bun src/lib/content/suggestions.test.ts`.
 */

import {
  applySuggestion,
  applySuggestions,
  locateSuggestions,
  parseModelIssues,
  removeSuggestion,
  suggestionsFromDiff,
  SUGGESTION_SYSTEM_PROMPT,
} from './suggestions';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assert(
    SUGGESTION_SYSTEM_PROMPT.includes('grammar|spelling|punctuation|clarity|style'),
    'prompt categories'
  );
  assert(SUGGESTION_SYSTEM_PROMPT.includes('{"issues"'), 'prompt json');

  assertEqual(parseModelIssues('just the corrected sentence'), null, 'plain text is not issues');

  const parsed = parseModelIssues(
    '```json\n{"issues":[{"quote":"Teh","replacement":"The","category":"spelling","explanation":"Corrected spelling."},{"quote":"problem","replacement":"problems","category":"grammar","explanation":"Use the plural."}]}\n```'
  );
  assert(parsed, 'fenced json parses');
  assertEqual(parsed?.length, 2, 'two issues');
  assertEqual(parsed?.[0]?.category, 'spelling', 'spelling category');

  const coerced = parseModelIssues(
    '{"issues":[{"quote":"we","replacement":"we\'ve","category":"other","explanation":"Added an apostrophe."}]}'
  );
  assertEqual(coerced?.[0]?.category, 'style', 'other maps to style');

  const text = 'Teh meeting has several problem.';
  const located = locateSuggestions(text, parsed ?? []);
  assertEqual(located.length, 2, 'both quotes match');
  assertEqual(text.slice(located[0].start, located[0].end), 'Teh', 'first span');
  assertEqual(text.slice(located[1].start, located[1].end), 'problem', 'second span');

  const applied = applySuggestions(text, located);
  assertEqual(applied, 'The meeting has several problems.', 'apply from the end');

  const one = applySuggestion(text, located[0]);
  assert(one.text.startsWith('The meeting'), 'single accept');
  assertEqual(one.delta, 0, 'same length delta');

  const grouped = suggestionsFromDiff('35 year old man', '35-year-old man');
  assert(grouped.length >= 1, 'diff produces a card');
  assert(
    grouped.some((card) => card.quote.includes('year') && card.replacement.includes('year-old')),
    'adjacent words group into one card'
  );

  const spelling = suggestionsFromDiff('Teh cat', 'The cat');
  assertEqual(spelling.length, 1, 'one spelling card');
  assertEqual(spelling[0]?.category, 'spelling', 'single word is spelling');
  assertEqual(spelling[0]?.explanation, "Changed 'Teh' to 'The'.", 'generic explanation');

  const separated = suggestionsFromDiff('Teh cat sat badly', 'The cat sat poorly');
  assertEqual(separated.length, 2, 'an unchanged word splits cards');
  assertEqual(separated[0]?.quote.trim(), 'Teh', 'first separated quote');
  assert(separated[1]?.quote.includes('badly'), 'second separated quote');

  const empty = parseModelIssues('{"issues":[]}');
  assert(empty && empty.length === 0, 'empty issues array is valid');
  const missed = locateSuggestions('Hello', parsed ?? []);
  assertEqual(missed.length, 0, 'quotes that are not in the text are dropped');

  const shifted = removeSuggestion(located, located[0].id, located[0].start, located[0].end, 0);
  assertEqual(shifted.length, 1, 'accept drops that card');
  assertEqual(shifted[0]?.quote, 'problem', 'later card remains');

  const grown = removeSuggestion(
    [
      { ...located[1], start: 10, end: 17 },
      { ...located[0], id: 'later', start: 20, end: 23 },
    ],
    located[1].id,
    10,
    17,
    1
  );
  assertEqual(grown[0]?.start, 21, 'later card shifts by the length change');

  console.log('suggestions tests passed');
}

run();
