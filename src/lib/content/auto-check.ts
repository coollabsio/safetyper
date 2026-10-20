/**
 * Pure helpers for opt-in checking while typing.
 * Segments, the paragraph cache, and position updates stay free of the DOM.
 */

import type { Suggestion, SuggestionCategory } from './suggestions';

export const AUTO_CHECK_BACKOFF_START_MS = 4_000;
export const AUTO_CHECK_BACKOFF_MAX_MS = 60_000;
const MAX_SEGMENT_CHARS = 700;

export interface TextSegment {
  start: number;
  end: number;
  text: string;
  hash: string;
}

export interface AutoCheckFieldInfo {
  tagName: string;
  type: string;
  hidden: boolean;
  ariaHidden: boolean;
  readOnly: boolean;
  disabled: boolean;
  autoComplete: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  maxLength: number;
  inputMode: string;
}

const BLOCKED_AUTOCOMPLETE = new Set([
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
  'current-password',
  'new-password',
  'one-time-code',
]);

const SENSITIVE_TEXT =
  /\b(password|passwd|passcode|credit\s*card|card\s*number|cvv|cvc|csc|otp|one[\s-]?time(?:\s*code)?|verification\s*code|security\s*code)\b/i;

export function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function nextBackoffMs(previous: number): number {
  if (previous <= 0) return AUTO_CHECK_BACKOFF_START_MS;
  return Math.min(AUTO_CHECK_BACKOFF_MAX_MS, previous * 2);
}

export function isHostDisabled(host: string, disabledHosts: readonly string[]): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  return disabledHosts.some((entry) => entry.trim().toLowerCase() === normalized);
}

export function shouldAutoCheck(input: {
  enabled: boolean;
  host: string;
  disabledHosts: readonly string[];
  documentHidden: boolean;
  trimmedLength: number;
  minChars: number;
  blocked: boolean;
  composing: boolean;
}): boolean {
  if (!input.enabled || input.documentHidden || input.blocked || input.composing) return false;
  if (isHostDisabled(input.host, input.disabledHosts)) return false;
  return input.trimmedLength >= input.minChars;
}

export function isBlockedAutoCheckField(info: AutoCheckFieldInfo): boolean {
  if (info.hidden || info.ariaHidden || info.readOnly || info.disabled) return true;

  const type = info.type.toLowerCase();
  const tag = info.tagName.toUpperCase();
  if (tag === 'INPUT') {
    if (type === 'password' || type === 'hidden' || type === '') return true;
    const textLike = ['text', 'search', 'url', 'tel', 'email'].includes(type);
    if (!textLike) return true;
  }

  const tokens = info.autoComplete
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => BLOCKED_AUTOCOMPLETE.has(token) || token.startsWith('cc-'))) {
    return true;
  }

  const label = [info.name, info.id, info.placeholder, info.ariaLabel]
    .join(' ')
    .replace(/[_-]+/g, ' ');
  if (SENSITIVE_TEXT.test(label)) return true;

  const inputMode = info.inputMode.toLowerCase();
  const shortCode = info.maxLength > 0 && info.maxLength <= 8;
  const codeLike =
    inputMode === 'numeric' || inputMode === 'decimal' || type === 'tel' || type === 'number';
  if (tag === 'INPUT' && shortCode && codeLike) return true;
  if (/\b(otp|pin|2fa|mfa)\b/i.test(label) && (shortCode || info.maxLength === 0)) return true;

  return false;
}

export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === '\n') {
      splitLine(text, lineStart, index, segments);
      lineStart = index + 1;
    }
  }
  return segments;
}

function splitLine(text: string, start: number, end: number, segments: TextSegment[]): void {
  if (end <= start) return;
  const line = text.slice(start, end);
  const sentenceEnd = /[.!?]+(?:\s+|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let emitted = false;
  while ((match = sentenceEnd.exec(line))) {
    emitChunk(text, start + cursor, start + match.index + match[0].length, segments);
    cursor = match.index + match[0].length;
    emitted = true;
    if (cursor >= line.length) break;
  }
  if (!emitted) {
    emitChunk(text, start, end, segments);
    return;
  }
  if (cursor < line.length) emitChunk(text, start + cursor, end, segments);
}

function emitChunk(text: string, start: number, end: number, segments: TextSegment[]): void {
  let cursor = start;
  while (cursor < end) {
    const remaining = end - cursor;
    if (remaining <= MAX_SEGMENT_CHARS) {
      pushSegment(text, cursor, end, segments);
      return;
    }
    const window = text.slice(cursor, cursor + MAX_SEGMENT_CHARS);
    let breakAt = window.lastIndexOf(' ');
    if (breakAt < 40) breakAt = MAX_SEGMENT_CHARS;
    else breakAt += 1;
    pushSegment(text, cursor, cursor + breakAt, segments);
    cursor += breakAt;
  }
}

function pushSegment(text: string, start: number, end: number, segments: TextSegment[]): void {
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (!trimmed) return;
  const bodyStart = start + leading;
  const bodyEnd = bodyStart + trimmed.length;
  const body = text.slice(bodyStart, bodyEnd);
  segments.push({
    start: bodyStart,
    end: bodyEnd,
    text: body,
    hash: hashText(body),
  });
}

export interface SegmentPlan {
  issues: Suggestion[];
  pending: TextSegment[];
}

/**
 * Issues for unchanged segments come from the hash cache.
 * Segments missing from the cache are the only ones that need a request.
 */
export function collectCachedIssues(
  text: string,
  segments: readonly TextSegment[],
  cache: ReadonlyMap<string, Suggestion[]>
): SegmentPlan {
  const issues: Suggestion[] = [];
  const pending: TextSegment[] = [];
  for (const segment of segments) {
    const cached = cache.get(segment.hash);
    if (!cached) {
      pending.push(segment);
      continue;
    }
    issues.push(...placeSegmentIssues(segment, cached));
  }
  return { issues: normalizeIssues(text, issues), pending };
}

export function placeSegmentIssues(
  segment: TextSegment,
  relative: readonly Suggestion[]
): Suggestion[] {
  const placed: Suggestion[] = [];
  for (const suggestion of relative) {
    if (segment.text.slice(suggestion.start, suggestion.end) !== suggestion.quote) continue;
    placed.push({
      ...suggestion,
      id: `${segment.hash}:${suggestion.start}:${suggestion.quote}`,
      start: segment.start + suggestion.start,
      end: segment.start + suggestion.end,
    });
  }
  return placed;
}

/**
 * Replace issues that overlap one segment. Issues in other segments stay put.
 */
export function mergeSegmentResult(
  text: string,
  issues: readonly Suggestion[],
  segment: TextSegment,
  relative: readonly Suggestion[]
): Suggestion[] {
  const kept = issues.filter((issue) => issue.end <= segment.start || issue.start >= segment.end);
  return normalizeIssues(text, [...kept, ...placeSegmentIssues(segment, relative)]);
}

export function mapIssuesAcrossEdit(
  oldText: string,
  newText: string,
  issues: readonly Suggestion[]
): Suggestion[] {
  if (oldText === newText) return normalizeIssues(newText, issues);
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const delta = newText.length - oldText.length;
  const oldEditEnd = oldText.length - suffix;
  const moved: Suggestion[] = [];
  for (const issue of issues) {
    if (issue.end <= prefix) {
      moved.push(issue);
      continue;
    }
    if (issue.start >= oldEditEnd) {
      moved.push({ ...issue, start: issue.start + delta, end: issue.end + delta });
      continue;
    }
    moved.push(issue);
  }
  return normalizeIssues(newText, moved);
}

/**
 * Keep an issue only when its quote still sits at the mapped offsets.
 * A quote that no longer matches is stale and is dropped instead of sliding onto another copy.
 */
export function normalizeIssues(text: string, issues: readonly Suggestion[]): Suggestion[] {
  const sorted = [...issues].sort((a, b) => a.start - b.start || a.end - b.end);
  const used: Array<[number, number]> = [];
  const result: Suggestion[] = [];
  for (const issue of sorted) {
    if (!issue.quote) continue;
    const { start, end } = issue;
    if (start < 0 || end > text.length || start >= end) continue;
    if (text.slice(start, end) !== issue.quote) continue;
    if (used.some(([usedStart, usedEnd]) => start < usedEnd && end > usedStart)) continue;
    used.push([start, end]);
    result.push(issue);
  }
  return result;
}

export function relativeSuggestions(
  segment: TextSegment,
  issues: readonly Suggestion[]
): Suggestion[] {
  const relative: Suggestion[] = [];
  for (const issue of issues) {
    if (issue.start < segment.start || issue.end > segment.end) continue;
    const start = issue.start - segment.start;
    const end = issue.end - segment.start;
    if (segment.text.slice(start, end) !== issue.quote) continue;
    relative.push({ ...issue, start, end });
  }
  return relative;
}

export function suggestionStub(
  quote: string,
  replacement: string,
  start: number,
  category: SuggestionCategory = 'grammar'
): Suggestion {
  return {
    id: `test-${start}`,
    quote,
    replacement,
    category,
    explanation: `Changed '${quote}' to '${replacement}'.`,
    start,
    end: start + quote.length,
  };
}
