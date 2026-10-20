/**
 * Group colors for the in-field icon badge.
 *
 * Ids, membership, and palette come from src/lib/categories.ts. The badge fill
 * is the group's darker text token so white type stays readable on the disc.
 * The dark value is that group's dark-theme accent, for a dark surface.
 */

import {
  recognizedGroup,
  SUGGESTION_GROUPS,
  SUGGESTION_GROUP_IDS,
  type SuggestionGroupId,
} from '../categories';

export { SUGGESTION_GROUP_IDS };
export type { SuggestionGroupId };

/** Highest priority first. The icon uses the first group that is present. */
export const GROUP_PRIORITY: readonly SuggestionGroupId[] = SUGGESTION_GROUP_IDS;

export const GROUP_COLORS: Record<SuggestionGroupId, { light: string; dark: string }> =
  Object.fromEntries(
    SUGGESTION_GROUPS.map((group) => [
      group.id,
      { light: group.colors.light.text, dark: group.colors.dark.accent },
    ])
  ) as Record<SuggestionGroupId, { light: string; dark: string }>;

export function groupForIssue(issue: {
  group?: unknown;
  subcategory?: unknown;
  category?: unknown;
}): SuggestionGroupId | null {
  return recognizedGroup(issue);
}

export function highestPriorityGroup(
  issues: Array<{ group?: unknown; subcategory?: unknown; category?: unknown }>
): SuggestionGroupId | null {
  let best: SuggestionGroupId | null = null;
  let rank = GROUP_PRIORITY.length;
  for (const issue of issues) {
    const group = groupForIssue(issue);
    if (!group) continue;
    const next = GROUP_PRIORITY.indexOf(group);
    if (next < rank) {
      rank = next;
      best = group;
    }
  }
  return best;
}

export function groupFill(group: SuggestionGroupId | null, surface: 'light' | 'dark'): string {
  if (!group) return surface === 'dark' ? '#4ade80' : '#15803d';
  return GROUP_COLORS[group][surface];
}
