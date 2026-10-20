/**
 * Suggestion groups shared by in-page cards and future underlines.
 *
 * Keep every id, label, and color here. Underlines should read
 * `groupColorStyle` and the `--st-<group>-accent` variables instead of
 * hard-coding a second palette. The full-page editor can import this module
 * the same way; it does not depend on the editor.
 */

export const SUGGESTION_GROUP_IDS = ['correctness', 'clarity', 'engagement', 'delivery'] as const;

export type SuggestionGroupId = (typeof SUGGESTION_GROUP_IDS)[number];

export interface CategoryColorTokens {
  /** Label and chip text. */
  text: string;
  /** Selected chip fill. */
  surface: string;
  /** Left accent, dot, and future underline. */
  accent: string;
}

export interface SuggestionGroup {
  id: SuggestionGroupId;
  label: string;
  description: string;
  colors: { light: CategoryColorTokens; dark: CategoryColorTokens };
}

const GROUP_COLORS: Record<
  SuggestionGroupId,
  { light: CategoryColorTokens; dark: CategoryColorTokens }
> = {
  correctness: {
    light: {
      text: 'oklch(46% 0.17 25)',
      surface: 'oklch(96.5% 0.02 25)',
      accent: 'oklch(55% 0.2 25)',
    },
    dark: {
      text: 'oklch(82% 0.1 25)',
      surface: 'oklch(32% 0.05 25)',
      accent: 'oklch(72% 0.16 25)',
    },
  },
  clarity: {
    light: {
      text: 'oklch(42% 0.14 255)',
      surface: 'oklch(96.5% 0.018 255)',
      accent: 'oklch(50% 0.16 255)',
    },
    dark: {
      text: 'oklch(82% 0.08 250)',
      surface: 'oklch(32% 0.04 255)',
      accent: 'oklch(75% 0.12 250)',
    },
  },
  engagement: {
    light: {
      text: 'oklch(40% 0.12 155)',
      surface: 'oklch(96.5% 0.02 155)',
      accent: 'oklch(48% 0.14 155)',
    },
    dark: {
      text: 'oklch(84% 0.13 155)',
      surface: 'oklch(32% 0.045 155)',
      accent: 'oklch(78% 0.15 155)',
    },
  },
  delivery: {
    light: {
      text: 'oklch(44% 0.16 310)',
      surface: 'oklch(96.5% 0.02 310)',
      accent: 'oklch(50% 0.18 310)',
    },
    dark: {
      text: 'oklch(82% 0.1 310)',
      surface: 'oklch(32% 0.05 310)',
      accent: 'oklch(74% 0.14 310)',
    },
  },
};

export const SUGGESTION_GROUPS: readonly SuggestionGroup[] = [
  {
    id: 'correctness',
    label: 'Correctness',
    description: 'Spelling, grammar, and punctuation',
    colors: GROUP_COLORS.correctness,
  },
  {
    id: 'clarity',
    label: 'Clarity',
    description: 'Conciseness, wordiness, and readability',
    colors: GROUP_COLORS.clarity,
  },
  {
    id: 'engagement',
    label: 'Engagement',
    description: 'Word choice and vivid or monotonous wording',
    colors: GROUP_COLORS.engagement,
  },
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'Formality, confidence, politeness, and tone',
    colors: GROUP_COLORS.delivery,
  },
];

export const SUGGESTION_SUBCATEGORIES = [
  { id: 'spelling', label: 'Spelling', group: 'correctness' },
  { id: 'grammar', label: 'Grammar', group: 'correctness' },
  { id: 'punctuation', label: 'Punctuation', group: 'correctness' },
  { id: 'conciseness', label: 'Conciseness', group: 'clarity' },
  { id: 'wordiness', label: 'Wordiness', group: 'clarity' },
  { id: 'readability', label: 'Readability', group: 'clarity' },
  { id: 'word-choice', label: 'Word choice', group: 'engagement' },
  { id: 'vividness', label: 'Vivid wording', group: 'engagement' },
  { id: 'monotonous', label: 'Monotonous wording', group: 'engagement' },
  { id: 'formality', label: 'Formality', group: 'delivery' },
  { id: 'confidence', label: 'Confidence', group: 'delivery' },
  { id: 'politeness', label: 'Politeness', group: 'delivery' },
  { id: 'tone', label: 'Tone', group: 'delivery' },
] as const;

export type SuggestionSubcategoryId = (typeof SUGGESTION_SUBCATEGORIES)[number]['id'];

export interface IssueClassification {
  group: SuggestionGroupId;
  subcategory: SuggestionSubcategoryId;
  /** Mirrors `subcategory` so cached cards and older callers keep one issue type. */
  category: SuggestionSubcategoryId;
}

/**
 * Vague group-only replies land on these. Correctness stays on grammar, which
 * was the previous fallback. Clarity lands on readability rather than a cut.
 */
const DEFAULT_SUBCATEGORY: Record<SuggestionGroupId, SuggestionSubcategoryId> = {
  correctness: 'grammar',
  clarity: 'readability',
  engagement: 'word-choice',
  delivery: 'tone',
};

const DEFAULT_CLASSIFICATION: IssueClassification = {
  group: 'correctness',
  subcategory: 'grammar',
  category: 'grammar',
};

/** Previous prompt values. `other` used to collapse into style. */
const LEGACY_CATEGORIES: Record<string, IssueClassification> = {
  spelling: pack('correctness', 'spelling'),
  grammar: pack('correctness', 'grammar'),
  punctuation: pack('correctness', 'punctuation'),
  clarity: pack('clarity', 'readability'),
  style: pack('engagement', 'word-choice'),
  other: pack('engagement', 'word-choice'),
};

const SUBCATEGORY_ALIASES: Record<string, SuggestionSubcategoryId> = {
  spelling: 'spelling',
  grammar: 'grammar',
  punctuation: 'punctuation',
  conciseness: 'conciseness',
  concision: 'conciseness',
  wordiness: 'wordiness',
  readability: 'readability',
  'word-choice': 'word-choice',
  wordchoice: 'word-choice',
  vividness: 'vividness',
  vivid: 'vividness',
  'vivid-wording': 'vividness',
  monotonous: 'monotonous',
  monotone: 'monotonous',
  'monotonous-wording': 'monotonous',
  formality: 'formality',
  confidence: 'confidence',
  politeness: 'politeness',
  tone: 'tone',
};

const GROUP_ALIASES: Record<string, SuggestionGroupId> = {
  correctness: 'correctness',
  clarity: 'clarity',
  engagement: 'engagement',
  delivery: 'delivery',
  tone: 'delivery',
  'delivery-tone': 'delivery',
};

function pack(group: SuggestionGroupId, subcategory: SuggestionSubcategoryId): IssueClassification {
  return { group, subcategory, category: subcategory };
}

function token(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return normalized.length > 0 ? normalized : null;
}

function subcategoryOf(value: unknown): SuggestionSubcategoryId | null {
  const key = token(value);
  if (!key) return null;
  return SUBCATEGORY_ALIASES[key] ?? null;
}

function groupOfToken(value: unknown): SuggestionGroupId | null {
  const key = token(value);
  if (!key) return null;
  return GROUP_ALIASES[key] ?? null;
}

export function subcategoryGroup(id: SuggestionSubcategoryId): SuggestionGroupId {
  const found = SUGGESTION_SUBCATEGORIES.find((item) => item.id === id);
  return found ? found.group : 'correctness';
}

export function groupLabel(id: SuggestionGroupId): string {
  return SUGGESTION_GROUPS.find((group) => group.id === id)?.label ?? 'Correctness';
}

/**
 * CSS custom properties for one theme. Set them on the card or underline host:
 * `--st-correctness-accent`, `--st-correctness-text`, `--st-correctness-surface`,
 * and the same three for clarity, engagement, and delivery.
 */
export function groupColorStyle(theme: 'light' | 'dark'): Record<string, string> {
  const style: Record<string, string> = {};
  for (const group of SUGGESTION_GROUPS) {
    const colors = group.colors[theme];
    style[`--st-${group.id}-accent`] = colors.accent;
    style[`--st-${group.id}-text`] = colors.text;
    style[`--st-${group.id}-surface`] = colors.surface;
  }
  return style;
}

export function countByGroup(
  items: ReadonlyArray<{ group: SuggestionGroupId }>
): Record<SuggestionGroupId, number> {
  const counts: Record<SuggestionGroupId, number> = {
    correctness: 0,
    clarity: 0,
    engagement: 0,
    delivery: 0,
  };
  for (const item of items) counts[item.group] += 1;
  return counts;
}

/**
 * Group already stored on an issue, or null when it names nothing we know.
 * An explicit group wins. A subcategory or legacy category is used otherwise.
 * Unlike `classifyIssue`, this does not invent a default.
 */
export function recognizedGroup(input: {
  group?: unknown;
  subcategory?: unknown;
  category?: unknown;
}): SuggestionGroupId | null {
  const group = groupOfToken(input.group);
  if (group) return group;

  const subcategory = subcategoryOf(input.subcategory);
  if (subcategory) return subcategoryGroup(subcategory);

  const legacyKey = token(input.category);
  if (legacyKey && LEGACY_CATEGORIES[legacyKey]) return LEGACY_CATEGORIES[legacyKey].group;

  const fromCategory = subcategoryOf(input.category);
  if (fromCategory) return subcategoryGroup(fromCategory);

  return groupOfToken(input.category);
}

/**
 * New replies carry `group` and `subcategory`. Older replies carry only
 * `category` (`grammar`, `spelling`, `punctuation`, `clarity`, `style`, `other`).
 * A known subcategory wins over a mismatched group.
 */
export function classifyIssue(input: {
  group?: unknown;
  subcategory?: unknown;
  category?: unknown;
}): IssueClassification {
  const subcategory = subcategoryOf(input.subcategory);
  if (subcategory) return pack(subcategoryGroup(subcategory), subcategory);

  const group = groupOfToken(input.group);
  if (group) return pack(group, DEFAULT_SUBCATEGORY[group]);

  const legacyKey = token(input.category);
  if (legacyKey && LEGACY_CATEGORIES[legacyKey]) return LEGACY_CATEGORIES[legacyKey];

  const fromCategory = subcategoryOf(input.category);
  if (fromCategory) return pack(subcategoryGroup(fromCategory), fromCategory);

  const categoryGroup = groupOfToken(input.category);
  if (categoryGroup) return pack(categoryGroup, DEFAULT_SUBCATEGORY[categoryGroup]);

  return DEFAULT_CLASSIFICATION;
}

export function issueResponseSchema(): string {
  const groups = SUGGESTION_GROUP_IDS.join('|');
  const subcategories = SUGGESTION_SUBCATEGORIES.map((item) => item.id).join('|');
  return `{"issues":[{"quote":"exact substring from the passage","replacement":"corrected substring","group":"${groups}","subcategory":"${subcategories}","explanation":"one short sentence"}]}`;
}

export function groupMembershipRules(): string {
  return SUGGESTION_GROUPS.map((group) => {
    const members = SUGGESTION_SUBCATEGORIES.filter((item) => item.group === group.id)
      .map((item) => item.id)
      .join(', ');
    return `${group.id} (${members})`;
  }).join('; ');
}
