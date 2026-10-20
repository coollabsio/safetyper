/**
 * Clean replies for short text such as "hello".
 * Execute with `bun src/lib/content/check-result.test.ts`.
 */

import { interpretCheckReply, UnusableCheckReply } from './check-result';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  const empty = interpretCheckReply('hello', '{"issues":[]}');
  assertEqual(empty.suggestions.length, 0, 'an empty issues array is clean');
  assertEqual(empty.correctedText, 'hello', 'clean text is unchanged');

  const prose = interpretCheckReply('hello', 'No issues found.');
  assertEqual(prose.suggestions.length, 0, 'plain text with no issues is clean');

  const echo = interpretCheckReply('hello', 'hello');
  assertEqual(echo.suggestions.length, 0, 'an unchanged echo is clean');

  const quoted = interpretCheckReply('hello', '"hello"');
  assertEqual(quoted.suggestions.length, 0, 'a quoted echo is clean');

  const fix = interpretCheckReply(
    'i are baboon',
    '{"issues":[{"quote":"i are baboon","replacement":"I am a baboon","category":"grammar","explanation":"Agreement."}]}'
  );
  assertEqual(fix.suggestions.length, 1, 'a real issue is kept');
  assertEqual(fix.correctedText, 'I am a baboon', 'the replacement is applied');

  let threw = false;
  try {
    interpretCheckReply('hello', '{"response":"not the contract"}');
  } catch (error) {
    threw = error instanceof UnusableCheckReply;
  }
  assert(threw, 'json that is not an issues object is an error');
}

run();
console.log('check result tests passed');
