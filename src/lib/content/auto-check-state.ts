/**
 * Snapshot of the field currently being checked while typing.
 * Kept separate so the popup can read it without a circular import.
 */

import type { Suggestion } from './suggestions';

export interface AutoCheckSnapshot {
  field: HTMLElement | null;
  text: string;
  issues: Suggestion[];
}

const emptySnapshot = (): AutoCheckSnapshot => ({ field: null, text: '', issues: [] });

let snapshot: AutoCheckSnapshot = emptySnapshot();
let cancelImpl: () => void = () => {};
let dismissImpl: () => void = () => {};

export function getAutoCheckSnapshot(): AutoCheckSnapshot {
  return snapshot;
}

export function setAutoCheckSnapshot(next: AutoCheckSnapshot): void {
  snapshot = next;
}

export function clearAutoCheckSnapshot(): void {
  snapshot = emptySnapshot();
}

export function setAutoCheckCancel(cancel: () => void): void {
  cancelImpl = cancel;
}

export function cancelAutoCheck(): void {
  cancelImpl();
}

export function setAutoCheckDismiss(dismiss: () => void): void {
  dismissImpl = dismiss;
}

/** Republish underlines and the badge after a suggestion is dismissed. */
export function refreshAutoCheckIssues(): void {
  dismissImpl();
}
