/**
 * Underline colors for suggestion categories.
 *
 * Every category points at its own CSS variable. Those variables currently all
 * resolve to one neutral underline so the page does not imply a category color
 * yet. Recolor a category by changing its variable in content.css.
 */

import type { SuggestionCategory } from './suggestions';

export const CATEGORY_COLOR_VARS: Record<SuggestionCategory, string> = {
  grammar: '--st-cat-grammar',
  spelling: '--st-cat-spelling',
  punctuation: '--st-cat-punctuation',
  clarity: '--st-cat-clarity',
  style: '--st-cat-style',
};

export function categoryColorVariable(category: SuggestionCategory): string {
  return `var(${CATEGORY_COLOR_VARS[category]})`;
}
