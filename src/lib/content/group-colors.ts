/**
 * Group colors for the in-field icon.
 *
 * Ids match src/lib/categories.ts on the groups branch (correctness, clarity,
 * engagement, delivery) so the two maps can be joined later. This file does not
 * import that module.
 */

export const SUGGESTION_GROUP_IDS = ['correctness', 'clarity', 'engagement', 'delivery'] as const;

export type SuggestionGroupId = (typeof SUGGESTION_GROUP_IDS)[number];

/** Highest priority first. The icon uses the first group that is present. */
export const GROUP_PRIORITY: readonly SuggestionGroupId[] = [
  'correctness',
  'clarity',
  'engagement',
  'delivery',
];

/**
 * Fills for a count circle with white type. Light values are the darker text
 * tokens from the groups palette so the number stays AA on the fill.
 */
export const GROUP_COLORS: Record<SuggestionGroupId, { light: string; dark: string }> = {
  correctness: { light: 'oklch(46% 0.17 25)', dark: 'oklch(72% 0.16 25)' },
  clarity: { light: 'oklch(42% 0.14 255)', dark: 'oklch(75% 0.12 250)' },
  engagement: { light: 'oklch(40% 0.12 155)', dark: 'oklch(78% 0.15 155)' },
  delivery: { light: 'oklch(44% 0.16 310)', dark: 'oklch(74% 0.14 310)' },
};

const CATEGORY_GROUP: Record<string, SuggestionGroupId> = {
  spelling: 'correctness',
  grammar: 'correctness',
  punctuation: 'correctness',
  correctness: 'correctness',
  clarity: 'clarity',
  conciseness: 'clarity',
  wordiness: 'clarity',
  readability: 'clarity',
  style: 'engagement',
  engagement: 'engagement',
  'word-choice': 'engagement',
  vividness: 'engagement',
  monotonous: 'engagement',
  delivery: 'delivery',
  formality: 'delivery',
  confidence: 'delivery',
  politeness: 'delivery',
  tone: 'delivery',
};

export function groupForIssue(issue: {
  group?: unknown;
  category?: unknown;
}): SuggestionGroupId | null {
  if (
    typeof issue.group === 'string' &&
    (SUGGESTION_GROUP_IDS as readonly string[]).includes(issue.group)
  ) {
    return issue.group as SuggestionGroupId;
  }
  if (typeof issue.category === 'string') return CATEGORY_GROUP[issue.category] ?? null;
  return null;
}

export function highestPriorityGroup(
  issues: Array<{ group?: unknown; category?: unknown }>
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
