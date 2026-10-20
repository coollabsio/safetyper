/**
 * Suggestion cards for the in-page popup.
 * Pure functions: parse a model JSON reply, or derive cards from a word diff.
 */

import { classifyIssue, type IssueClassification } from '../categories';
import { DEFAULT_SYSTEM_PROMPT } from './config';
import { diffTexts } from './diff-engine';

export interface Suggestion extends IssueClassification {
  id: string;
  quote: string;
  replacement: string;
  explanation: string;
  start: number;
  end: number;
}

export interface ModelIssue extends IssueClassification {
  quote: string;
  replacement: string;
  explanation: string;
}

export const SUGGESTION_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Parse a structured model reply. Returns null when the reply is not that JSON shape,
 * so the caller can fall back to a plain corrected-text diff.
 * `group` and `subcategory` are preferred. Older `category` values still parse.
 */
export function parseModelIssues(raw: string): ModelIssue[] | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('issues' in parsed)) return null;
  const issues = (parsed as { issues: unknown }).issues;
  if (!Array.isArray(issues)) return null;

  const result: ModelIssue[] = [];
  for (const item of issues) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record.quote !== 'string' || typeof record.replacement !== 'string') return null;
    const quote = record.quote;
    const replacement = record.replacement;
    if (quote.trim().length === 0 || quote === replacement) continue;
    const explanation =
      typeof record.explanation === 'string' && record.explanation.trim().length > 0
        ? record.explanation.trim()
        : genericExplanation(quote, replacement);
    result.push({
      quote,
      replacement,
      ...classifyIssue({
        group: record.group,
        subcategory: record.subcategory,
        category: record.category,
      }),
      explanation,
    });
  }
  return result;
}

function rangesOverlap(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([usedStart, usedEnd]) => start < usedEnd && end > usedStart);
}

/**
 * Keep issues whose quote appears in the passage. Later duplicates can match later copies.
 */
export function locateSuggestions(text: string, issues: ModelIssue[]): Suggestion[] {
  const used: Array<[number, number]> = [];
  const suggestions: Suggestion[] = [];
  issues.forEach((issue, index) => {
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(issue.quote, from);
      if (start === -1) break;
      const end = start + issue.quote.length;
      if (!rangesOverlap(start, end, used)) {
        used.push([start, end]);
        suggestions.push({
          id: `issue-${index}-${start}`,
          quote: issue.quote,
          replacement: issue.replacement,
          group: issue.group,
          subcategory: issue.subcategory,
          category: issue.category,
          explanation: issue.explanation,
          start,
          end,
        });
        break;
      }
      from = start + 1;
    }
  });
  return suggestions.sort((a, b) => a.start - b.start);
}

function inferClassification(original: string, replacement: string): IssueClassification {
  const punctuation = /[\s.,!?;:'"“”‘’()\-–—/]+/;
  const onlyPunctuation = (value: string) =>
    value.length > 0 && value.replace(punctuation, '').length === 0;
  if (onlyPunctuation(original) || onlyPunctuation(replacement)) {
    return classifyIssue({ subcategory: 'punctuation' });
  }
  if (
    original.includes("'") !== replacement.includes("'") &&
    original.replace(/'/g, '') === replacement.replace(/'/g, '')
  ) {
    return classifyIssue({ subcategory: 'punctuation' });
  }
  const origWords = original.trim().split(/\s+/).filter(Boolean);
  const nextWords = replacement.trim().split(/\s+/).filter(Boolean);
  if (origWords.length === 1 && nextWords.length === 1) {
    return classifyIssue({ subcategory: 'spelling' });
  }
  return classifyIssue({ subcategory: 'grammar' });
}

export function genericExplanation(original: string, replacement: string): string {
  const from = original.trim();
  const to = replacement.trim();
  if (!from && to) return `Added '${clip(to)}'.`;
  if (from && !to) return `Removed '${clip(from)}'.`;
  return `Changed '${clip(from)}' to '${clip(to)}'.`;
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > 48 ? `${flat.slice(0, 45)}...` : flat;
}

/**
 * Group adjacent word edits into one card. Unchanged tokens separate cards.
 */
export function suggestionsFromDiff(original: string, corrected: string): Suggestion[] {
  if (original === corrected) return [];
  const operations = diffTexts(original, corrected);
  const suggestions: Suggestion[] = [];
  let cursor = 0;
  let pendingOriginal = '';
  let pendingReplacement = '';
  let pendingStart = 0;

  const flush = () => {
    if (pendingOriginal === pendingReplacement) {
      pendingOriginal = '';
      pendingReplacement = '';
      return;
    }
    if (pendingOriginal.length === 0 && pendingReplacement.length === 0) return;
    const quote = pendingOriginal;
    const replacement = pendingReplacement;
    suggestions.push({
      id: `diff-${pendingStart}-${pendingStart + quote.length}`,
      quote,
      replacement,
      ...inferClassification(quote, replacement),
      explanation: genericExplanation(quote, replacement),
      start: pendingStart,
      end: pendingStart + quote.length,
    });
    pendingOriginal = '';
    pendingReplacement = '';
  };

  const isWhitespace = (value: string) => /^\s*$/.test(value);

  for (const operation of operations) {
    if (operation.type === 'equal') {
      flush();
      cursor += operation.text.length;
      continue;
    }
    if (pendingOriginal.length === 0 && pendingReplacement.length === 0) {
      pendingStart = cursor;
    }
    if (operation.type === 'delete') {
      pendingOriginal += operation.text;
      cursor += operation.text.length;
    } else {
      pendingReplacement += operation.text;
    }
  }
  flush();
  return suggestions.filter((suggestion) => {
    if (suggestion.quote === suggestion.replacement) return false;
    if (isWhitespace(suggestion.quote) && isWhitespace(suggestion.replacement)) return false;
    return true;
  });
}

/** Rebuild a cached card, including ones saved before group and subcategory existed. */
export function hydrateSuggestion(value: unknown): Suggestion | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.quote !== 'string' || typeof record.replacement !== 'string') return null;
  if (typeof record.start !== 'number' || typeof record.end !== 'number') return null;
  const explanation =
    typeof record.explanation === 'string' && record.explanation.trim().length > 0
      ? record.explanation.trim()
      : genericExplanation(record.quote, record.replacement);
  return {
    id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `issue-${record.start}`,
    quote: record.quote,
    replacement: record.replacement,
    ...classifyIssue({
      group: record.group,
      subcategory: record.subcategory,
      category: record.category,
    }),
    explanation,
    start: record.start,
    end: record.end,
  };
}

export function applySuggestion(
  text: string,
  suggestion: Suggestion
): { text: string; delta: number; start: number; end: number; changed: boolean } {
  let start = suggestion.start;
  let end = suggestion.end;
  if (text.slice(start, end) !== suggestion.quote) {
    const index = text.indexOf(suggestion.quote);
    if (index === -1) {
      return { text, delta: 0, start, end, changed: false };
    }
    start = index;
    end = index + suggestion.quote.length;
  }
  const delta = suggestion.replacement.length - (end - start);
  return {
    text: text.slice(0, start) + suggestion.replacement + text.slice(end),
    delta,
    start,
    end,
    changed: true,
  };
}

export function applySuggestions(text: string, suggestions: Suggestion[]): string {
  const ordered = [...suggestions].sort((a, b) => b.start - a.start);
  return ordered.reduce((current, suggestion) => applySuggestion(current, suggestion).text, text);
}

/**
 * Drop the applied card. Later cards move by the length change.
 * A card that overlapped the edit is dropped so its quote cannot land in the wrong place.
 */
export function removeSuggestion(
  suggestions: Suggestion[],
  id: string,
  appliedStart: number,
  appliedEnd: number,
  delta: number
): Suggestion[] {
  const next: Suggestion[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.id === id) continue;
    if (suggestion.end <= appliedStart) {
      next.push(suggestion);
      continue;
    }
    if (suggestion.start >= appliedEnd) {
      next.push({
        ...suggestion,
        start: suggestion.start + delta,
        end: suggestion.end + delta,
      });
    }
  }
  return next;
}
