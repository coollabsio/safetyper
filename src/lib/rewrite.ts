/**
 * One-click rewrites for the passage currently shown in the suggestion popup.
 * Parsing stays here so it can be tested without the browser or the network.
 */

import { composeSystemPrompt, type WritingGoals } from './goals';

export const REWRITE_OPTIONS = [
  {
    id: 'clarity',
    label: 'Improve clarity',
    instruction: 'Improve clarity. Make the passage easier to read without adding new facts.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    instruction:
      'Shorten the passage. Remove wordiness and repetition. Keep the necessary meaning.',
  },
  {
    id: 'formal',
    label: 'More formal',
    instruction: 'Make the passage more formal. Avoid slang and contractions.',
  },
  {
    id: 'friendly',
    label: 'More friendly',
    instruction: 'Make the passage more friendly and polite. Keep it sincere.',
  },
  {
    id: 'confident',
    label: 'More confident',
    instruction: 'Make the passage more confident. Replace hedging and weak wording.',
  },
] as const;

export type RewriteOptionId = (typeof REWRITE_OPTIONS)[number]['id'];
export type RewriteOption = (typeof REWRITE_OPTIONS)[number];

export function rewriteOption(id: string): RewriteOption | null {
  return REWRITE_OPTIONS.find((option) => option.id === id) ?? null;
}

export function rewriteSystemPrompt(option: RewriteOption): string {
  return [
    'You rewrite a passage. Keep the meaning and the language of the passage.',
    `Task: ${option.instruction}`,
    'Reply with one JSON object and nothing else:',
    '{"rewrite":"the full rewritten passage"}',
    'Rules:',
    '- Return the whole passage, not a list of edits.',
    '- Preserve paragraph breaks.',
    '- Do not wrap the JSON in markdown.',
  ].join('\n');
}

export function rewritePrompt(option: RewriteOption, goals: WritingGoals): string {
  return composeSystemPrompt(rewriteSystemPrompt(option), goals);
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Read a rewrite reply. JSON `{"rewrite":"..."}` wins. A bare passage is accepted.
 * An issues object, or any other JSON object, is rejected so a check reply
 * cannot be applied as a full rewrite.
 */
export function parseRewrite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const json = extractJsonObject(trimmed);
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === 'object') {
        if (!('rewrite' in parsed)) return null;
        const rewrite = (parsed as { rewrite: unknown }).rewrite;
        if (typeof rewrite !== 'string') return null;
        const text = rewrite.trim();
        return text.length > 0 ? text : null;
      }
    } catch {
      // Not JSON. Fall through to the plain-text passage.
    }
  }
  const plain = stripWrappingQuotes(trimmed);
  if (!plain || plain.startsWith('{') || plain.startsWith('[')) return null;
  return plain;
}
