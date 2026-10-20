/**
 * Writing goals sent with every check and rewrite.
 * Stored locally under `writingGoals`. Nothing here touches the network.
 */

export const WRITING_GOALS_STORAGE_KEY = 'writingGoals';

export const AUDIENCES = ['general', 'knowledgeable', 'expert'] as const;
export const FORMALITIES = ['informal', 'neutral', 'formal'] as const;
export const DOMAINS = ['general', 'academic', 'business', 'casual', 'email'] as const;
export const INTENTS = ['inform', 'describe', 'convince', 'tell-a-story'] as const;

export type Audience = (typeof AUDIENCES)[number];
export type Formality = (typeof FORMALITIES)[number];
export type Domain = (typeof DOMAINS)[number];
export type Intent = (typeof INTENTS)[number];

export interface WritingGoals {
  audience: Audience;
  formality: Formality;
  domain: Domain;
  intent: Intent;
}

export interface GoalOption<T extends string> {
  id: T;
  label: string;
}

export const AUDIENCE_OPTIONS: readonly GoalOption<Audience>[] = [
  { id: 'general', label: 'General' },
  { id: 'knowledgeable', label: 'Knowledgeable' },
  { id: 'expert', label: 'Expert' },
];

export const FORMALITY_OPTIONS: readonly GoalOption<Formality>[] = [
  { id: 'informal', label: 'Informal' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'formal', label: 'Formal' },
];

export const DOMAIN_OPTIONS: readonly GoalOption<Domain>[] = [
  { id: 'general', label: 'General' },
  { id: 'academic', label: 'Academic' },
  { id: 'business', label: 'Business' },
  { id: 'casual', label: 'Casual' },
  { id: 'email', label: 'Email' },
];

export const INTENT_OPTIONS: readonly GoalOption<Intent>[] = [
  { id: 'inform', label: 'Inform' },
  { id: 'describe', label: 'Describe' },
  { id: 'convince', label: 'Convince' },
  { id: 'tell-a-story', label: 'Tell a story' },
];

export const DEFAULT_WRITING_GOALS: WritingGoals = {
  audience: 'general',
  formality: 'neutral',
  domain: 'general',
  intent: 'inform',
};

const AUDIENCE_DETAIL: Record<Audience, string> = {
  general: 'general readers with no special background',
  knowledgeable: 'knowledgeable readers who know the topic',
  expert: 'expert readers who want precise wording',
};

const DOMAIN_DETAIL: Record<Domain, string> = {
  general: 'a general context',
  academic: 'academic writing',
  business: 'business writing',
  casual: 'casual writing',
  email: 'an email',
};

const INTENT_DETAIL: Record<Intent, string> = {
  inform: 'inform the reader',
  describe: 'describe something',
  convince: 'convince the reader',
  'tell-a-story': 'tell a story',
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

/** Drop unknown or partial storage values back to the defaults, field by field. */
export function parseWritingGoals(value: unknown): WritingGoals {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    audience: oneOf(record.audience, AUDIENCES, DEFAULT_WRITING_GOALS.audience),
    formality: oneOf(record.formality, FORMALITIES, DEFAULT_WRITING_GOALS.formality),
    domain: oneOf(record.domain, DOMAINS, DEFAULT_WRITING_GOALS.domain),
    intent: oneOf(record.intent, INTENTS, DEFAULT_WRITING_GOALS.intent),
  };
}

export function writingGoalsInstructions(goals: WritingGoals): string {
  const resolved = parseWritingGoals(goals);
  return [
    'Writing goals for this passage:',
    `- Audience: ${AUDIENCE_DETAIL[resolved.audience]}`,
    `- Formality: ${resolved.formality}`,
    `- Domain: ${DOMAIN_DETAIL[resolved.domain]}`,
    `- Intent: ${INTENT_DETAIL[resolved.intent]}`,
    'Prefer suggestions and rewrites that fit these goals. Do not change the meaning or the language.',
  ].join('\n');
}

export function composeSystemPrompt(base: string, goals: WritingGoals): string {
  const instructions = writingGoalsInstructions(goals);
  const trimmed = base.trim();
  if (!trimmed) return instructions;
  return `${trimmed}\n\n${instructions}`;
}
