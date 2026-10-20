/**
 * Passage handed from the page to the popup Translate tab.
 * `at` matches translateDraftEpoch so an older popup cannot overwrite the draft.
 */

export interface TranslateHandoff {
  text: string;
  at: number;
  translation?: string;
  detected?: string;
}

export function isTranslateHandoff(value: unknown): value is TranslateHandoff {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string' || typeof record.at !== 'number') return false;
  if (record.translation !== undefined && typeof record.translation !== 'string') return false;
  if (record.detected !== undefined && typeof record.detected !== 'string') return false;
  return true;
}
