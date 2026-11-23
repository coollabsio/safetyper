import { describe, expect, it } from 'vitest';
import {
  copyFullTextCompactLabel,
  copyFullTextExplanation,
  copyFullTextLabel,
} from './copy-full-text';
import { applySuggestions, applySuggestionsOutcome, type Suggestion } from './suggestions';

function suggestion(
  id: string,
  quote: string,
  replacement: string,
  start: number,
  end: number
): Suggestion {
  return {
    id,
    quote,
    replacement,
    explanation: 'Test fix.',
    start,
    end,
    group: 'correctness',
    subcategory: 'spelling',
    category: 'spelling',
  };
}

describe('copy full text label', () => {
  it('drops the count when nothing will change', () => {
    expect(copyFullTextLabel(0)).toBe('Copy full text');
    expect(copyFullTextCompactLabel(0)).toBe('Copy full text');
    expect(copyFullTextExplanation(0)).toBe('Copies your whole text, ready to paste.');
  });

  it('uses the singular and plural for the fixes that will be applied', () => {
    expect(copyFullTextLabel(1)).toBe('Copy full text · 1 fix');
    expect(copyFullTextLabel(2)).toBe('Copy full text · 2 fixes');
    expect(copyFullTextCompactLabel(2)).toBe('Copy full · 2');
    expect(copyFullTextExplanation(1)).toBe(
      'Copies your whole text with the 1 fix applied, ready to paste.'
    );
    expect(copyFullTextExplanation(3)).toBe(
      'Copies your whole text with the 3 fixes applied, ready to paste.'
    );
  });
});

describe('applySuggestionsOutcome', () => {
  const text = 'Teh meeting has several problem.';
  const spelling = suggestion('spelling', 'Teh', 'The', 0, 3);
  const grammar = suggestion('grammar', 'problem', 'problems', 24, 31);

  it('counts every fix that lands in the copied text', () => {
    const outcome = applySuggestionsOutcome(text, [spelling, grammar]);
    expect(outcome.applied).toBe(2);
    expect(outcome.text).toBe('The meeting has several problems.');
    expect(outcome.text).toBe(applySuggestions(text, [spelling, grammar]));
  });

  it('counts only the suggestions the caller passes', () => {
    const outcome = applySuggestionsOutcome(text, [grammar]);
    expect(outcome.applied).toBe(1);
    expect(outcome.text).toBe('Teh meeting has several problems.');
  });

  it('does not count a suggestion whose quote is no longer in the text', () => {
    const missing = suggestion('missing', 'colour', 'color', 0, 6);
    const outcome = applySuggestionsOutcome(text, [spelling, missing]);
    expect(outcome.applied).toBe(1);
    expect(outcome.text).toBe('The meeting has several problem.');
  });

  it('does not count an overlapping suggestion that the earlier edit invalidates', () => {
    const passage = 'aaaa';
    const first = suggestion('first', 'aa', 'b', 0, 2);
    const overlap = suggestion('overlap', 'aa', 'c', 1, 3);
    const outcome = applySuggestionsOutcome(passage, [first, overlap]);
    expect(outcome.applied).toBe(1);
    expect(outcome.text).toBe('aca');
  });
});
