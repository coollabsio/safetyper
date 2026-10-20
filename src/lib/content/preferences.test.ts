/**
 * Runnable checks for dictionary matching, category filters, and dismissals.
 * Execute with `bun src/lib/content/preferences.test.ts`.
 */

import { classifyIssue } from '../categories';
import { applySuggestions, type Suggestion } from './suggestions';
import {
  addDictionaryWord,
  dictionaryPromptHint,
  dictionaryToText,
  dictionaryWordFromQuote,
  DICTIONARY_PROMPT_HINT_LIMIT,
  filterSuggestions,
  indexAfterRemoval,
  mergeDictionary,
  nextCardIndex,
  parseDictionaryText,
  readDictionary,
  readDisabledGroups,
  removeDictionaryWord,
  removeSuggestionsForWord,
  systemPromptWithDictionary,
} from './preferences';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function card(quote: string, replacement: string, category: string, start = 0): Suggestion {
  return {
    id: `${category}-${start}-${quote}`,
    quote,
    replacement,
    ...classifyIssue({ category }),
    explanation: `${quote} -> ${replacement}`,
    start,
    end: start + quote.length,
  };
}

function run(): void {
  assertEqual(dictionaryWordFromQuote('  Teh '), 'Teh', 'one flagged word');
  assertEqual(dictionaryWordFromQuote('has several'), null, 'a phrase is not one word');
  assertEqual(dictionaryWordFromQuote("don't"), "don't", 'apostrophe stays with the word');

  let words = addDictionaryWord([], 'Teh');
  words = addDictionaryWord(words, 'teh');
  words = addDictionaryWord(words, '  ');
  words = addDictionaryWord(words, 'hello world');
  assertEqual(words.length, 1, 'dictionary keeps the first casing and skips phrases');
  assertEqual(words[0], 'Teh', 'original casing is stored');

  words = addDictionaryWord(words, 'Colour');
  assertEqual(removeDictionaryWord(words, 'COLOUR').join(','), 'Teh', 'remove ignores case');
  assertEqual(
    readDictionary(['Teh', 'teh', 4, 'ok']).join(','),
    'Teh,ok',
    'storage values are cleaned'
  );
  assertEqual(
    readDisabledGroups(['engagement', 'nope', 'clarity', 'engagement']).join(','),
    'clarity,engagement',
    'only known groups, in display order'
  );

  const imported = parseDictionaryText('# names\n\nHello\nhello\nworld!\n(colour), sentance\n');
  assertEqual(
    imported.join(','),
    'Hello,world,colour,sentance',
    'import skips comments and duplicates'
  );
  assert(dictionaryToText(imported).startsWith('Hello\n'), 'export is one word per line');
  assertEqual(
    mergeDictionary(['Hello'], parseDictionaryText('hello\nworld')).join(','),
    'Hello,world',
    'import merges without duplicating case'
  );

  const hint = dictionaryPromptHint(['alpha', 'beta']);
  assert(hint.startsWith('Do not flag these words: '), 'hint names the list');
  assert(hint.includes('alpha, beta'), 'hint lists the words');
  assertEqual(dictionaryPromptHint([]), '', 'empty dictionary adds no hint');
  const capped = dictionaryPromptHint(
    ['aaaa', 'bbbb', 'cccc'],
    'Do not flag these words: '.length + 4
  );
  assertEqual(capped, 'Do not flag these words: aaaa', 'hint stops before the cap');
  assert(capped.length <= DICTIONARY_PROMPT_HINT_LIMIT, 'default cap is larger than this sample');
  const prompted = systemPromptWithDictionary('Base prompt.', ['Teh']);
  assert(
    prompted.startsWith('Base prompt.\nDo not flag these words: Teh'),
    'hint follows the prompt'
  );
  assertEqual(
    systemPromptWithDictionary('Base prompt.', []),
    'Base prompt.',
    'no hint leaves the prompt'
  );

  const text = 'Teh meeting has several problem.';
  const spelling = card('Teh', 'The', 'spelling', 0);
  const grammar = card('problem', 'problems', 'grammar', text.indexOf('problem'));
  const style = card('meeting', 'session', 'style', text.indexOf('meeting'));
  const phrase = card('has several', 'have several', 'grammar', text.indexOf('has several'));
  const suggestions = [spelling, phrase, grammar, style];

  const byDictionary = filterSuggestions(suggestions, { dictionary: ['teh'] });
  assertEqual(
    byDictionary.map((item) => item.quote).join('|'),
    'has several|problem|meeting',
    'spelling word is hidden case-insensitively'
  );
  const grammarKept = filterSuggestions([card('Teh', 'The', 'grammar', 0)], {
    dictionary: ['Teh'],
  });
  assertEqual(grammarKept.length, 1, 'dictionary does not hide a grammar card');

  const byGroup = filterSuggestions(suggestions, { disabledGroups: ['engagement', 'clarity'] });
  assert(
    byGroup.every((item) => item.group !== 'engagement'),
    'turned-off groups are dropped'
  );
  assertEqual(byGroup.length, 3, 'other groups stay');
  const correctnessOff = filterSuggestions(suggestions, { disabledGroups: ['correctness'] });
  assertEqual(correctnessOff.length, 1, 'correctness hides spelling and grammar together');
  assertEqual(correctnessOff[0]?.group, 'engagement', 'engagement stays when correctness is off');

  const dismissed = filterSuggestions(suggestions, { dismissedQuotes: ['problem'] });
  assert(
    dismissed.every((item) => item.quote !== 'problem'),
    'a dismissed quote stays hidden'
  );
  assertEqual(dismissed.length, 3, 'other quotes stay after dismiss');

  const actionable = filterSuggestions(suggestions, {
    dictionary: ['teh'],
    disabledGroups: ['engagement'],
    dismissedQuotes: ['problem'],
  });
  assertEqual(actionable.map((item) => item.quote).join('|'), 'has several', 'filters combine');
  assertEqual(
    applySuggestions(text, actionable),
    'Teh meeting have several problem.',
    'accept all skips dismissed, ignored, and dictionary words'
  );

  const withoutWord = removeSuggestionsForWord(
    [spelling, card('teh', 'the', 'grammar', 40), phrase],
    'TEH'
  );
  assertEqual(
    withoutWord.map((item) => item.id).join(','),
    phrase.id,
    'adding a word removes every card for that word'
  );

  assertEqual(nextCardIndex(-1, 1, 3), 0, 'arrow down from outside lands on the first card');
  assertEqual(nextCardIndex(-1, -1, 3), 2, 'arrow up from outside lands on the last card');
  assertEqual(nextCardIndex(2, 1, 3), 2, 'arrow down stays on the last card');
  assertEqual(nextCardIndex(0, -1, 3), 0, 'arrow up stays on the first card');
  assertEqual(indexAfterRemoval(1, 2), 1, 'focus stays on the card that slides into place');
  assertEqual(indexAfterRemoval(2, 1), 0, 'removing the last card focuses the new last card');
  assertEqual(indexAfterRemoval(0, 0), -1, 'an empty list has nothing to focus');

  console.log('preferences tests passed');
}

run();
