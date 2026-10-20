/**
 * Turn a model reply into suggestion cards.
 * An empty issues array, an unchanged passage, or a plain "no issues" reply is a clean result.
 */

import { readsAsNoIssues } from '../ai/no-issues';
import {
  applySuggestions,
  locateSuggestions,
  parseModelIssues,
  suggestionsFromDiff,
  type Suggestion,
} from './suggestions';

export interface InterpretedCheck {
  correctedText: string;
  suggestions: Suggestion[];
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export class UnusableCheckReply extends Error {
  constructor() {
    super('The model did not return suggestions as JSON. Try again.');
    this.name = 'UnusableCheckReply';
  }
}

export function interpretCheckReply(text: string, raw: string): InterpretedCheck {
  const trimmed = raw.trim();
  if (!trimmed || readsAsNoIssues(trimmed, text)) {
    return { correctedText: text, suggestions: [] };
  }

  const issues = parseModelIssues(trimmed);
  if (issues) {
    const suggestions = locateSuggestions(text, issues);
    return {
      suggestions,
      correctedText: applySuggestions(text, suggestions),
    };
  }

  if (looksLikeJson(trimmed)) {
    throw new UnusableCheckReply();
  }

  let corrected = trimmed;
  if (
    (corrected.startsWith('"') && corrected.endsWith('"')) ||
    (corrected.startsWith('“') && corrected.endsWith('”'))
  ) {
    corrected = corrected.slice(1, -1);
  }
  if (readsAsNoIssues(corrected, text)) {
    return { correctedText: text, suggestions: [] };
  }
  return {
    correctedText: corrected,
    suggestions: suggestionsFromDiff(text, corrected),
  };
}
