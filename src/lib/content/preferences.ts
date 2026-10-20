/**
 * Personal dictionary and suggestion filters.
 * Pure functions so checks can run without the extension APIs.
 */

import { SUGGESTION_GROUP_IDS, type SuggestionGroupId } from '../categories';
import type { Suggestion } from './suggestions';

export const PERSONAL_DICTIONARY_KEY = 'personalDictionary';
export const DISABLED_GROUPS_KEY = 'disabledGroups';

export const DICTIONARY_WORD_LIMIT = 500;
export const DICTIONARY_PROMPT_HINT_LIMIT = 280;

const WORD_SOURCE = "[\\p{L}\\p{N}]+(?:['’-][\\p{L}\\p{N}]+)*";

export function normalizeDictionaryWord(word: string): string {
  return word.trim().toLowerCase();
}

export function dictionaryWordsInQuote(quote: string): string[] {
  return quote.match(new RegExp(WORD_SOURCE, 'gu')) ?? [];
}

/** The single word a spelling card can add. Phrases are not one dictionary entry. */
export function dictionaryWordFromQuote(quote: string): string | null {
  const words = dictionaryWordsInQuote(quote);
  if (words.length !== 1) return null;
  return words[0];
}

function isDictionaryToken(word: string): boolean {
  return new RegExp(`^${WORD_SOURCE}$`, 'u').test(word);
}

export function addDictionaryWord(words: readonly string[], word: string): string[] {
  const trimmed = word.trim();
  if (!isDictionaryToken(trimmed)) return [...words];
  if (words.length >= DICTIONARY_WORD_LIMIT) return [...words];
  const key = normalizeDictionaryWord(trimmed);
  if (words.some((existing) => normalizeDictionaryWord(existing) === key)) return [...words];
  return [...words, trimmed];
}

export function removeDictionaryWord(words: readonly string[], word: string): string[] {
  const key = normalizeDictionaryWord(word);
  return words.filter((existing) => normalizeDictionaryWord(existing) !== key);
}

export function readDictionary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  let words: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    words = addDictionaryWord(words, item);
  }
  return words;
}

export function readDisabledGroups(value: unknown): SuggestionGroupId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SuggestionGroupId>();
  for (const item of value) {
    if (typeof item === 'string' && (SUGGESTION_GROUP_IDS as readonly string[]).includes(item)) {
      seen.add(item as SuggestionGroupId);
    }
  }
  return SUGGESTION_GROUP_IDS.filter((group) => seen.has(group));
}

function cleanImportedToken(token: string): string {
  return token.replace(new RegExp(`^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}'’-]+$`, 'gu'), '');
}

/** One word per line. Blank lines and # comments are skipped. Commas split a line. */
export function parseDictionaryText(text: string): string[] {
  let words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const token of trimmed.split(/[\s,;]+/)) {
      words = addDictionaryWord(words, cleanImportedToken(token));
    }
  }
  return words;
}

export function dictionaryToText(words: readonly string[]): string {
  return words.length > 0 ? `${words.join('\n')}\n` : '';
}

export function mergeDictionary(words: readonly string[], incoming: readonly string[]): string[] {
  return incoming.reduce<string[]>((current, word) => addDictionaryWord(current, word), [...words]);
}

/**
 * Short prompt line so the model skips known words. Stops before `limit` characters.
 */
export function dictionaryPromptHint(
  words: readonly string[],
  limit: number = DICTIONARY_PROMPT_HINT_LIMIT
): string {
  const prefix = 'Do not flag these words: ';
  if (words.length === 0 || limit < prefix.length + 1) return '';
  const selected: string[] = [];
  let used = prefix.length;
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const addition = `${selected.length > 0 ? ', ' : ''}${trimmed}`;
    if (used + addition.length > limit) break;
    selected.push(trimmed);
    used += addition.length;
  }
  if (selected.length === 0) return '';
  return `${prefix}${selected.join(', ')}`;
}

export function systemPromptWithDictionary(basePrompt: string, words: readonly string[]): string {
  const hint = dictionaryPromptHint(words);
  if (!hint) return basePrompt;
  return `${basePrompt}\n${hint}`;
}

export function spellingMatchesDictionary(quote: string, dictionary: readonly string[]): boolean {
  const words = dictionaryWordsInQuote(quote);
  if (words.length === 0 || dictionary.length === 0) return false;
  const keys = new Set(dictionary.map((word) => normalizeDictionaryWord(word)));
  return words.every((word) => keys.has(normalizeDictionaryWord(word)));
}

export interface SuggestionFilter {
  dictionary?: readonly string[];
  disabledGroups?: readonly string[];
  dismissedQuotes?: readonly string[];
}

/**
 * Drop ignored groups, session dismissals, and spelling hits already in the dictionary.
 * Dictionary matching is case-insensitive and applies to spelling cards only.
 */
export function filterSuggestions(
  suggestions: readonly Suggestion[],
  filter: SuggestionFilter
): Suggestion[] {
  const disabled = new Set(filter.disabledGroups ?? []);
  const dismissed = new Set(filter.dismissedQuotes ?? []);
  const dictionary = filter.dictionary ?? [];
  return suggestions.filter((suggestion) => {
    if (disabled.has(suggestion.group)) return false;
    if (dismissed.has(suggestion.quote)) return false;
    if (
      suggestion.category === 'spelling' &&
      spellingMatchesDictionary(suggestion.quote, dictionary)
    ) {
      return false;
    }
    return true;
  });
}

/** Remove every card whose flagged text is this one word. */
export function removeSuggestionsForWord(
  suggestions: readonly Suggestion[],
  word: string
): Suggestion[] {
  const key = normalizeDictionaryWord(word);
  return suggestions.filter((suggestion) => {
    const words = dictionaryWordsInQuote(suggestion.quote);
    return !(words.length === 1 && normalizeDictionaryWord(words[0]) === key);
  });
}

export function nextCardIndex(current: number, direction: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  if (next < 0) return 0;
  if (next >= count) return count - 1;
  return next;
}

export function indexAfterRemoval(removedAt: number, remaining: number): number {
  if (remaining <= 0) return -1;
  const index = removedAt < 0 ? 0 : removedAt;
  return Math.min(index, remaining - 1);
}
