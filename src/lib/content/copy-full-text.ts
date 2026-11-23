/**
 * Header label for the read-only "copy the whole passage" action.
 * The count is how many fixes `applySuggestionsOutcome` will actually land.
 */

export const COPY_FULL_TEXT_FEEDBACK = 'Copied full text';
export const COPY_FULL_TEXT_FEEDBACK_MS = 1500;

export function copyFullTextLabel(applied: number): string {
  if (applied <= 0) return 'Copy full text';
  const noun = applied === 1 ? 'fix' : 'fixes';
  return `Copy full text · ${applied} ${noun}`;
}

/**
 * Phone-sheet fallback. The full phrase leaves no room for the wordmark
 * and the suggestion count once Rewrite and Close keep a touch target.
 */
export function copyFullTextCompactLabel(applied: number): string {
  if (applied <= 0) return 'Copy full text';
  return `Copy full · ${applied}`;
}

export function copyFullTextExplanation(applied: number): string {
  if (applied <= 0) return 'Copies your whole text, ready to paste.';
  const noun = applied === 1 ? 'fix' : 'fixes';
  return `Copies your whole text with the ${applied} ${noun} applied, ready to paste.`;
}
