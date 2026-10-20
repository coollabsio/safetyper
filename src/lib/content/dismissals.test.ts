/**
 * Dismissals stay tied to the flagged text, not to a shifting offset.
 * Execute with `bun src/lib/content/dismissals.test.ts`.
 */

import { mapIssuesAcrossEdit, suggestionStub } from './auto-check';
import { dismissInList, withoutDismissed } from './dismissals';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  const text = 'Hello i are baboon today';
  const issue = suggestionStub(
    'i are baboon',
    'I am a baboon',
    text.indexOf('i are baboon'),
    'grammar'
  );

  const cleared = dismissInList(text, [issue], [], issue);
  assertEqual(cleared.suggestions.length, 0, 'dismissing the only suggestion clears the list');
  assertEqual(cleared.dismissals.length, 1, 'the dismissal is recorded');

  const spaced = `Hello  i are baboon today`;
  const shifted = mapIssuesAcrossEdit(text, spaced, [issue]);
  assertEqual(shifted.length, 1, 'a space before the quote keeps the issue');
  assertEqual(
    spaced.slice(shifted[0].start, shifted[0].end),
    'i are baboon',
    'the quote still matches after the space'
  );
  assertEqual(
    withoutDismissed(spaced, shifted, cleared.dismissals).length,
    0,
    'adding a space elsewhere does not bring the dismissal back'
  );

  const changed = 'Hello i am baboon today';
  const fresh = suggestionStub(
    'i am baboon',
    'I am a baboon',
    changed.indexOf('i am baboon'),
    'grammar'
  );
  const revived = withoutDismissed(changed, [fresh], cleared.dismissals);
  assertEqual(revived.length, 1, 'editing the flagged text lets a new suggestion show');
  assertEqual(revived[0]?.quote, 'i am baboon', 'the new quote is the edited text');

  const other = suggestionStub(
    'i are baboon',
    'we are baboons',
    text.indexOf('i are baboon'),
    'grammar'
  );
  const kept = withoutDismissed(text, [issue, other], cleared.dismissals);
  assertEqual(kept.length, 1, 'a different replacement for the same quote stays visible');
  assertEqual(
    kept[0]?.replacement,
    'we are baboons',
    'the other suggestion is the one that remains'
  );

  const copy = suggestionStub('i are baboon', 'I am a baboon', 0, 'grammar');
  const later = { ...copy, id: 'later', start: 40, end: 52 };
  const both = dismissInList(`${text} ${text}`, [copy, later], [], copy);
  assertEqual(both.suggestions.length, 0, 'the same flagged text is dismissed at every offset');

  assert(
    shifted[0].start !== issue.start,
    'the surviving offset moved, so the dismissal cannot be keyed on it'
  );
}

run();
console.log('dismissals tests passed');
