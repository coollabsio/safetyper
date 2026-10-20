/**
 * How the in-field icon should read for a check result.
 */

import type { SuggestionGroupId } from './group-colors';

export type IconActivity = 'idle' | 'checking' | 'clean' | 'issues';

export interface IconPresentation {
  activity: IconActivity;
  count: number;
  /** Colored circle with the number. Used when automatic checking is on. */
  countAsIcon: boolean;
  group: SuggestionGroupId | null;
}

export function iconAriaLabel(activity: IconActivity, count: number): string {
  if (activity === 'checking') return 'SafeTyper is checking';
  if (activity === 'clean') return 'SafeTyper, no issues';
  if (count > 0) {
    return `SafeTyper, ${count} suggestion${count === 1 ? '' : 's'}`;
  }
  return 'Check grammar with SafeTyper';
}

export function suggestionTooltip(count: number): string {
  return `${count} suggestion${count === 1 ? '' : 's'}`;
}

export function presentIcon(input: {
  activity: IconActivity;
  count: number;
  autoCheck: boolean;
  group: SuggestionGroupId | null;
}): IconPresentation {
  const count = Math.max(0, Math.floor(input.count));
  const issues = input.activity === 'issues' && count > 0;
  return {
    activity: issues ? 'issues' : input.activity === 'issues' ? 'idle' : input.activity,
    count: issues ? count : 0,
    countAsIcon: issues && input.autoCheck,
    group: issues ? input.group : null,
  };
}
