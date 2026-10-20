/**
 * Rolling token budget shared by grammar checks and translation.
 * Tokens are estimated from characters because providers do not all report usage.
 */

export interface TokenSpend {
  at: number;
  tokens: number;
}

export const TOKEN_BUDGET = 8000;
export const TOKEN_BUDGET_WINDOW_MS = 60 * 1000;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function consumeTokenBudget(
  entries: readonly TokenSpend[],
  now: number,
  tokens: number,
  budget = TOKEN_BUDGET,
  windowMs = TOKEN_BUDGET_WINDOW_MS
): { allowed: boolean; entries: TokenSpend[] } {
  const fresh = entries.filter((entry) => now - entry.at < windowMs);
  if (tokens <= 0) return { allowed: true, entries: fresh };
  const used = fresh.reduce((sum, entry) => sum + entry.tokens, 0);
  if (tokens > budget || used + tokens > budget) {
    return { allowed: false, entries: fresh };
  }
  return { allowed: true, entries: [...fresh, { at: now, tokens }] };
}

export function refundTokenSpend(entries: readonly TokenSpend[], spend: TokenSpend): TokenSpend[] {
  const index = entries.indexOf(spend);
  if (index === -1) return [...entries];
  return entries.filter((_, entryIndex) => entryIndex !== index);
}
