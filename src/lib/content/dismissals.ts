/**
 * Session dismissals for one field.
 * The key is the flagged text plus the suggested replacement, never a character offset.
 * Typing before the quote leaves the dismissal in place. Editing the quote itself clears it.
 */

export interface Dismissal {
  quote: string;
  replacement: string;
}

export interface Dismissable {
  quote: string;
  replacement: string;
}

const byField = new WeakMap<object, Dismissal[]>();
const pageDismissals: Dismissal[] = [];

export function dismissalId(quote: string, replacement: string): string {
  return `${quote}\u0000${replacement}`;
}

export function rememberDismissal(field: object | null, suggestion: Dismissable): Dismissal[] {
  const list = field ? (byField.get(field) ?? []) : pageDismissals;
  const id = dismissalId(suggestion.quote, suggestion.replacement);
  if (!list.some((item) => dismissalId(item.quote, item.replacement) === id)) {
    list.push({ quote: suggestion.quote, replacement: suggestion.replacement });
  }
  if (field) byField.set(field, list);
  return list;
}

export function dismissalsFor(field: object | null): readonly Dismissal[] {
  if (!field) return pageDismissals;
  return byField.get(field) ?? [];
}

export function clearDismissalsForTests(): void {
  pageDismissals.splice(0, pageDismissals.length);
}

/** A dismissal applies only while that exact flagged text is still in the field. */
export function activeDismissals(text: string, dismissals: readonly Dismissal[]): Dismissal[] {
  return dismissals.filter((item) => item.quote.length > 0 && text.includes(item.quote));
}

export function withoutDismissed<T extends Dismissable>(
  text: string,
  suggestions: readonly T[],
  dismissals: readonly Dismissal[]
): T[] {
  const active = new Set(
    activeDismissals(text, dismissals).map((item) => dismissalId(item.quote, item.replacement))
  );
  if (active.size === 0) return [...suggestions];
  return suggestions.filter((item) => !active.has(dismissalId(item.quote, item.replacement)));
}

/**
 * Record a dismissal and return the suggestions that should still be underlined.
 * An empty list means the badge and the underlines clear.
 */
export function dismissInList<T extends Dismissable>(
  text: string,
  suggestions: readonly T[],
  dismissals: readonly Dismissal[],
  target: Dismissable
): { suggestions: T[]; dismissals: Dismissal[] } {
  const id = dismissalId(target.quote, target.replacement);
  const next = dismissals.some((item) => dismissalId(item.quote, item.replacement) === id)
    ? [...dismissals]
    : [...dismissals, { quote: target.quote, replacement: target.replacement }];
  return { dismissals: next, suggestions: withoutDismissed(text, suggestions, next) };
}
