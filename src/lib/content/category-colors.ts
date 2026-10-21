/**
 * Underline colors for suggestion groups.
 *
 * The palette lives in src/lib/categories.ts. These helpers publish that
 * palette as CSS variables and point each group's underline at its accent,
 * the same tokens the suggestion cards use.
 */

import { groupColorStyle, SUGGESTION_GROUP_IDS, type SuggestionGroupId } from '../categories';

export const GROUP_UNDERLINE_VARS: Record<SuggestionGroupId, string> = Object.fromEntries(
  SUGGESTION_GROUP_IDS.map((id) => [id, `--st-${id}-accent`])
) as Record<SuggestionGroupId, string>;

let appliedTheme: 'light' | 'dark' = 'light';
let published = false;

export function categoryColorVariable(group: SuggestionGroupId): string {
  return `var(${GROUP_UNDERLINE_VARS[group]})`;
}

/** Remember the theme without writing inline styles onto the host page. */
export function rememberGroupColorTheme(theme: 'light' | 'dark'): void {
  appliedTheme = theme;
}

export function groupColorVariablesPublished(): boolean {
  return published;
}

/** Publish the shared palette on the page so highlight rules and bars can read it. */
export function applyGroupColorVariables(theme: 'light' | 'dark'): void {
  appliedTheme = theme;
  if (typeof document === 'undefined' || !document.documentElement) return;
  published = true;
  const style = groupColorStyle(theme);
  for (const [name, value] of Object.entries(style)) {
    document.documentElement.style.setProperty(name, value);
  }
}

export function ensureGroupColorVariables(): void {
  applyGroupColorVariables(appliedTheme);
}
