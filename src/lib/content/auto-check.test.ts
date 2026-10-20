/**
 * Checks for automatic proofreading: segment cache, position mapping, and field guards.
 * Execute with `bun src/lib/content/auto-check.test.ts`.
 */

import { CONFIG } from './config';
import { SUGGESTION_CATEGORIES } from './suggestions';
import { CATEGORY_COLOR_VARS } from './category-colors';
import { consumeTokenBudget, estimateTokens, refundTokenSpend, TOKEN_BUDGET } from './budget';
import {
  AUTO_CHECK_BACKOFF_MAX_MS,
  AUTO_CHECK_BACKOFF_START_MS,
  collectCachedIssues,
  hashText,
  isBlockedAutoCheckField,
  isHostDisabled,
  mapIssuesAcrossEdit,
  mergeSegmentResult,
  nextBackoffMs,
  placeSegmentIssues,
  relativeSuggestions,
  segmentText,
  shouldAutoCheck,
  suggestionStub,
  type AutoCheckFieldInfo,
} from './auto-check';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function field(partial: Partial<AutoCheckFieldInfo>): AutoCheckFieldInfo {
  return {
    tagName: 'INPUT',
    type: 'text',
    hidden: false,
    ariaHidden: false,
    readOnly: false,
    disabled: false,
    autoComplete: '',
    name: '',
    id: '',
    placeholder: '',
    ariaLabel: '',
    maxLength: -1,
    inputMode: '',
    ...partial,
  };
}

function run(): void {
  assert(
    CONFIG.AUTO_CHECK_DEBOUNCE >= 1500 && CONFIG.AUTO_CHECK_DEBOUNCE <= 2000,
    'auto-check waits for a typing pause between 1.5s and 2s'
  );
  assert(CONFIG.AUTO_CHECK_MIN_CHARS >= 8, 'auto-check ignores very short text');

  for (const category of SUGGESTION_CATEGORIES) {
    assert(
      CATEGORY_COLOR_VARS[category].startsWith('--st-cat-'),
      `${category} has its own underline variable`
    );
  }

  assertEqual(hashText('Teh'), hashText('Teh'), 'hash is stable');
  assert(hashText('Teh') !== hashText('The'), 'different text hashes differently');

  assertEqual(nextBackoffMs(0), AUTO_CHECK_BACKOFF_START_MS, 'first error waits 4s');
  assertEqual(nextBackoffMs(4000), 8000, 'backoff doubles');
  assertEqual(nextBackoffMs(AUTO_CHECK_BACKOFF_MAX_MS), AUTO_CHECK_BACKOFF_MAX_MS, 'backoff caps');

  assertEqual(estimateTokens(''), 0, 'empty text is zero tokens');
  assertEqual(estimateTokens('abcd'), 1, 'four characters are one token');
  assertEqual(estimateTokens('abcde'), 2, 'tokens round up');

  const firstSpend = consumeTokenBudget([], 0, 5000);
  assert(firstSpend.allowed, 'first spend fits the budget');
  const blocked = consumeTokenBudget(firstSpend.entries, 1_000, 4_000);
  assert(!blocked.allowed, 'budget blocks the next spend');
  assertEqual(blocked.entries.length, 1, 'a rejected spend is not recorded');
  const later = consumeTokenBudget(firstSpend.entries, TOKEN_BUDGET + 61_000, 4_000);
  assert(later.allowed, 'budget frees up after the window');
  assert(
    !consumeTokenBudget([], 0, TOKEN_BUDGET + 1).allowed,
    'one request cannot exceed the budget'
  );
  assertEqual(
    refundTokenSpend(firstSpend.entries, firstSpend.entries[0]).length,
    0,
    'refund removes the spend'
  );

  const paragraphs = segmentText('Alpha has problem.\n\nBeta has problem.');
  assertEqual(paragraphs.length, 2, 'a blank line splits paragraphs');
  assert(paragraphs[1].text.startsWith('Beta'), 'second paragraph starts at Beta');
  assertEqual(
    paragraphs[1].start,
    'Alpha has problem.\n\nBeta has problem.'.indexOf('Beta'),
    'offset'
  );
  assert(
    paragraphs.every((segment) => segment.hash === hashText(segment.text)),
    'segment hash'
  );

  const sentences = segmentText('Teh cat sat. The dog ran badly.');
  assertEqual(sentences.length, 2, 'a line splits into sentences');
  assertEqual(sentences[0].text, 'Teh cat sat.', 'first sentence');
  assert(sentences[1].text.includes('badly'), 'second sentence');
  assert(
    sentences.every(
      (segment) =>
        'Teh cat sat. The dog ran badly.'.slice(segment.start, segment.end) === segment.text
    ),
    'sentence offsets match the source'
  );

  const long = `${'word '.repeat(200)}end`;
  const chunks = segmentText(long);
  assert(chunks.length > 1, 'a very long line is split');
  assert(
    chunks.every((segment) => segment.text.length <= 700),
    'chunks stay within the cap'
  );
  assert(
    chunks.every((segment) => long.slice(segment.start, segment.end) === segment.text),
    'long-line offsets match the source'
  );

  const passage = 'Teh cat sat. The dog ran badly.';
  const cachedQuote = suggestionStub('Teh', 'The', sentences[0].text.indexOf('Teh'), 'spelling');
  const cache = new Map([[sentences[0].hash, [cachedQuote]]]);
  const plan = collectCachedIssues(passage, sentences, cache);
  assertEqual(plan.pending.length, 1, 'only the uncached sentence is pending');
  assert(plan.pending[0].text.includes('badly'), 'pending sentence is the edited one');
  assertEqual(plan.issues.length, 1, 'cached sentence restores its issue');
  assertEqual(
    passage.slice(plan.issues[0].start, plan.issues[0].end),
    'Teh',
    'cached issue offset'
  );

  const editedPassage = 'Teh cat sat. The dog ran poorly.';
  const editedSegments = segmentText(editedPassage);
  const editedPlan = collectCachedIssues(editedPassage, editedSegments, cache);
  assertEqual(editedPlan.issues.length, 1, 'unchanged sentence stays cached');
  assert(
    editedPlan.pending.every((segment) => !segment.text.startsWith('Teh cat sat')),
    'the unchanged sentence is not sent again'
  );

  assertEqual(
    placeSegmentIssues(sentences[0], [suggestionStub('nope', 'yes', 0)]).length,
    0,
    'stale cache quote is dropped'
  );

  const second = sentences[1];
  const badly = suggestionStub('badly', 'poorly', second.text.indexOf('badly'), 'style');
  const merged = mergeSegmentResult(passage, plan.issues, second, [badly]);
  assertEqual(merged.length, 2, 'merge keeps the other sentence');
  assert(
    merged.some((issue) => issue.quote === 'Teh'),
    'first issue remains'
  );
  assert(
    merged.some((issue) => issue.quote === 'badly'),
    'new issue is placed'
  );
  assertEqual(
    mergeSegmentResult(passage, merged, second, []).length,
    1,
    'an empty result clears that sentence'
  );

  const relative = relativeSuggestions(sentences[0], plan.issues);
  assertEqual(relative.length, 1, 'absolute issue converts back to the sentence');
  assertEqual(relative[0].start, sentences[0].text.indexOf('Teh'), 'relative offset');

  const shifted = mapIssuesAcrossEdit('Teh meeting', 'Hello Teh meeting', [
    suggestionStub('Teh', 'The', 0, 'spelling'),
  ]);
  assertEqual(shifted.length, 1, 'insertion keeps the issue');
  assertEqual(shifted[0].start, 6, 'issue shifts by the inserted length');
  assertEqual(
    'Hello Teh meeting'.slice(shifted[0].start, shifted[0].end),
    'Teh',
    'shifted quote matches'
  );

  const stable = mapIssuesAcrossEdit('Teh meeting is long', 'Teh meeting is longer', [
    suggestionStub('Teh', 'The', 0, 'spelling'),
  ]);
  assertEqual(stable.length, 1, 'an edit after the issue keeps it');
  assertEqual(stable[0].start, 0, 'earlier issue does not move');

  const dropped = mapIssuesAcrossEdit('Teh meeting', 'The meeting', [
    suggestionStub('Teh', 'The', 0, 'spelling'),
  ]);
  assertEqual(dropped.length, 0, 'a quote that no longer matches is dropped');

  const duplicates = mapIssuesAcrossEdit('Teh and Teh', `XTeh and Teh`, [
    suggestionStub('Teh', 'The', 0, 'spelling'),
    suggestionStub('Teh', 'The', 8, 'spelling'),
  ]);
  assertEqual(duplicates.length, 2, 'both copies shift');
  assertEqual(duplicates[0].start, 1, 'first copy');
  assertEqual(duplicates[1].start, 9, 'second copy');
  assertEqual(`XTeh and Teh`.slice(duplicates[1].start, duplicates[1].end), 'Teh', 'second quote');

  const keptApart = mapIssuesAcrossEdit('Teh and Teh', 'The and Teh', [
    suggestionStub('Teh', 'The', 0, 'spelling'),
    suggestionStub('Teh', 'The', 8, 'spelling'),
  ]);
  assertEqual(keptApart.length, 1, 'the edited copy is dropped');
  assertEqual(keptApart[0].start, 8, 'the untouched copy stays');
  assertEqual('The and Teh'.slice(keptApart[0].start, keptApart[0].end), 'Teh', 'untouched quote');

  const paragraph = 'Teh cat sat.\n\nThe dog ran.';
  const paragraphIssues = mapIssuesAcrossEdit(paragraph, 'Teh cat sat.\n\nThe dogs ran.', [
    suggestionStub('Teh', 'The', 0, 'spelling'),
  ]);
  assertEqual(paragraphIssues.length, 1, 'the other paragraph stays');
  assertEqual(paragraphIssues[0].start, 0, 'paragraph issue position is stable');

  assert(isBlockedAutoCheckField(field({ type: 'password' })), 'password');
  assert(isBlockedAutoCheckField(field({ type: 'hidden' })), 'hidden input');
  assert(isBlockedAutoCheckField(field({ hidden: true })), 'hidden attribute');
  assert(isBlockedAutoCheckField(field({ ariaHidden: true })), 'aria-hidden');
  assert(isBlockedAutoCheckField(field({ autoComplete: 'cc-number' })), 'card number');
  assert(isBlockedAutoCheckField(field({ autoComplete: 'section-card cc-csc' })), 'card csc');
  assert(isBlockedAutoCheckField(field({ autoComplete: 'one-time-code' })), 'one-time code');
  assert(isBlockedAutoCheckField(field({ autoComplete: 'current-password' })), 'current password');
  assert(isBlockedAutoCheckField(field({ name: 'credit_card' })), 'credit card name');
  assert(isBlockedAutoCheckField(field({ id: 'otp-code', maxLength: 6 })), 'otp id');
  assert(
    isBlockedAutoCheckField(field({ maxLength: 6, inputMode: 'numeric' })),
    'short numeric code'
  );
  assert(!isBlockedAutoCheckField(field({})), 'plain text is allowed');
  assert(
    !isBlockedAutoCheckField(field({ tagName: 'TEXTAREA', type: 'textarea', name: 'notes' })),
    'a notes textarea is allowed'
  );

  assert(isHostDisabled('Example.com', ['example.com']), 'host match ignores case');
  assert(!isHostDisabled('other.example', ['example.com']), 'a different host stays on');

  const allowed = {
    enabled: true,
    host: 'example.com',
    disabledHosts: [] as string[],
    documentHidden: false,
    trimmedLength: 20,
    minChars: CONFIG.AUTO_CHECK_MIN_CHARS,
    blocked: false,
    composing: false,
  };
  assert(shouldAutoCheck(allowed), 'a focused field with enough text can be checked');
  assert(!shouldAutoCheck({ ...allowed, enabled: false }), 'the setting defaults to off');
  assert(!shouldAutoCheck({ ...allowed, documentHidden: true }), 'a hidden tab does not send');
  assert(!shouldAutoCheck({ ...allowed, trimmedLength: 4 }), 'short text is skipped');
  assert(!shouldAutoCheck({ ...allowed, blocked: true }), 'a sensitive field is skipped');
  assert(!shouldAutoCheck({ ...allowed, composing: true }), 'ime composition waits');
  assert(
    !shouldAutoCheck({ ...allowed, disabledHosts: ['example.com'] }),
    'a paused site is skipped'
  );

  console.log('auto-check tests passed');
}

run();
