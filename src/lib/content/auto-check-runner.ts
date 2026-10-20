/**
 * Opt-in checks while the user types.
 * Unchanged sentences are served from a hash cache. In-flight requests are cancelled
 * when the text changes, and errors back off so a failing provider is not retried immediately.
 */

import { browser } from 'wxt/browser';
import { checkGrammar, GrammarCheckCancelled } from './api-client';
import {
  collectCachedIssues,
  isBlockedAutoCheckField,
  isHostDisabled,
  mapIssuesAcrossEdit,
  mergeSegmentResult,
  nextBackoffMs,
  segmentText,
  shouldAutoCheck,
  type AutoCheckFieldInfo,
  type TextSegment,
} from './auto-check';
import { setAutoCheckCancel, setAutoCheckSnapshot } from './auto-check-state';
import { CONFIG } from './config';
import { getTextContent, isEditableElement } from './dom-utils';
import type { Suggestion } from './suggestions';
import { clearUnderlines, renderUnderlines, setUnderlineClickHandler } from './underlines';
import { setIssueCount, showFieldIssues } from './ui-manager';

interface Settings {
  enabled: boolean;
  disabledHosts: string[];
}

let settings: Settings = { enabled: false, disabledHosts: [] };
let disposed = false;
let generation = 0;
let timer = 0;
let backoffMs = 0;
let backoffUntil = 0;
let composing = false;
let field: HTMLElement | null = null;
let text = '';
let issues: Suggestion[] = [];
let activeRequestId: string | null = null;
const cache = new Map<string, Suggestion[]>();

export function startAutoCheck(): () => void {
  disposed = false;
  setUnderlineClickHandler((issueId) => {
    const current = field;
    if (!current) return;
    showFieldIssues(issues, issueId);
  });
  setAutoCheckCancel(() => {
    generation += 1;
    window.clearTimeout(timer);
    void cancelInFlight();
  });

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('visibilitychange', onVisibility);
  browser.storage.onChanged.addListener(onStorageChanged);
  void loadSettings();

  return () => {
    disposed = true;
    generation += 1;
    window.clearTimeout(timer);
    void cancelInFlight();
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('visibilitychange', onVisibility);
    browser.storage.onChanged.removeListener(onStorageChanged);
    issues = [];
    field = null;
    publish();
  };
}

async function loadSettings(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(['autoCheckEnabled', 'autoCheckDisabledHosts']);
    if (disposed) return;
    settings = {
      enabled: stored.autoCheckEnabled === true,
      disabledHosts: readHosts(stored.autoCheckDisabledHosts),
    };
  } catch (error) {
    console.error('[SafeTyper] Failed to load auto-check settings:', error);
  }
}

function onStorageChanged(changes: Record<string, { newValue?: unknown }>, areaName: string): void {
  if (areaName !== 'local') return;
  if (!changes.autoCheckEnabled && !changes.autoCheckDisabledHosts) return;
  if (changes.autoCheckEnabled) settings.enabled = changes.autoCheckEnabled.newValue === true;
  if (changes.autoCheckDisabledHosts) {
    settings.disabledHosts = readHosts(changes.autoCheckDisabledHosts.newValue);
  }
  if (!settings.enabled || isHostDisabled(location.hostname, settings.disabledHosts)) {
    issues = [];
    publish();
    generation += 1;
    window.clearTimeout(timer);
    void cancelInFlight();
    return;
  }
  if (eligible()) schedule();
}

function onFocusIn(event: FocusEvent): void {
  const target = eventTarget(event);
  if (!target || target === field) return;
  field = target;
  text = getTextContent(target);
  issues = [];
  if (trackingAllowed(target)) {
    issues = collectCachedIssues(text, segmentText(text), cache).issues;
  }
  publish();
}

function onInput(event: Event): void {
  const target = eventTarget(event);
  if (!target || isOwnUi(event)) return;
  if (target !== field) {
    field = target;
    text = '';
    issues = [];
  }
  const nextText = getTextContent(target);
  if (!trackingAllowed(target)) {
    text = nextText;
    issues = [];
    publish();
    generation += 1;
    window.clearTimeout(timer);
    void cancelInFlight();
    return;
  }
  issues = mapIssuesAcrossEdit(text, nextText, issues);
  text = nextText;
  const segments = segmentText(text);
  const plan = collectCachedIssues(text, segments, cache);
  issues = keepPending(text, issues, segments, plan.pending, plan.issues);
  publish();
  if (!eligible() || plan.pending.length === 0) {
    if (!eligible()) {
      generation += 1;
      window.clearTimeout(timer);
      void cancelInFlight();
    }
    return;
  }
  schedule();
}

function onCompositionStart(): void {
  composing = true;
  window.clearTimeout(timer);
}

function onCompositionEnd(): void {
  composing = false;
  if (field) {
    const nextText = getTextContent(field);
    issues = mapIssuesAcrossEdit(text, nextText, issues);
    text = nextText;
    publish();
  }
  schedule();
}

function onVisibility(): void {
  if (document.hidden) {
    generation += 1;
    window.clearTimeout(timer);
    void cancelInFlight();
    return;
  }
  if (eligible()) schedule();
}

function schedule(): void {
  window.clearTimeout(timer);
  generation += 1;
  const token = generation;
  void cancelInFlight();
  if (!eligible()) return;
  const wait = Math.max(CONFIG.AUTO_CHECK_DEBOUNCE, backoffUntil - Date.now());
  timer = window.setTimeout(() => {
    void run(token);
  }, wait);
}

async function run(token: number): Promise<void> {
  if (token !== generation || !field || !eligible()) return;
  const latest = getTextContent(field);
  if (latest !== text) {
    issues = mapIssuesAcrossEdit(text, latest, issues);
    text = latest;
  }
  const segments = segmentText(text);
  const plan = collectCachedIssues(text, segments, cache);
  issues = keepPending(text, issues, segments, plan.pending, plan.issues);
  publish();
  if (plan.pending.length === 0) return;

  for (const segment of plan.pending) {
    if (token !== generation || document.hidden || !eligible()) return;
    if (Date.now() < backoffUntil) {
      schedule();
      return;
    }
    const requestId = `auto-${token}-${segment.start}-${segment.hash}`;
    activeRequestId = requestId;
    try {
      const result = await checkGrammar(segment.text, requestId);
      if (token !== generation || !field) return;
      const currentText = getTextContent(field);
      if (currentText !== text) return;
      const freshSegments = segmentText(currentText);
      const current = freshSegments.find(
        (item) => item.hash === segment.hash && item.start === segment.start
      );
      if (!current) return;
      cache.set(
        segment.hash,
        result.suggestions.map((suggestion) => ({ ...suggestion }))
      );
      issues = mergeSegmentResult(currentText, issues, current, result.suggestions);
      backoffMs = 0;
      backoffUntil = 0;
      publish();
    } catch (error) {
      if (isCancelled(error) || token !== generation) return;
      backoffMs = nextBackoffMs(backoffMs);
      backoffUntil = Date.now() + backoffMs;
      console.error('[SafeTyper] Auto-check failed:', error);
      setIssueCount(issues.length, issues);
      if (token === generation) schedule();
      return;
    } finally {
      if (activeRequestId === requestId) activeRequestId = null;
    }
  }
}

function keepPending(
  currentText: string,
  existing: Suggestion[],
  segments: TextSegment[],
  pending: TextSegment[],
  cached: Suggestion[]
): Suggestion[] {
  const pendingKeys = new Set(pending.map((segment) => `${segment.start}:${segment.hash}`));
  const held = existing.filter((issue) => {
    const owner = segments.find(
      (segment) => issue.start >= segment.start && issue.end <= segment.end
    );
    return !!owner && pendingKeys.has(`${owner.start}:${owner.hash}`);
  });
  const combined = [...held, ...cached];
  return combined.filter((issue, index) => {
    if (currentText.slice(issue.start, issue.end) !== issue.quote) return false;
    return (
      combined.findIndex((other) => other.start === issue.start && other.quote === issue.quote) ===
      index
    );
  });
}

function trackingAllowed(target: HTMLElement): boolean {
  if (!settings.enabled || isHostDisabled(location.hostname, settings.disabledHosts)) return false;
  if (!isEditableElement(target) || isBlockedAutoCheckField(fieldInfo(target))) return false;
  return true;
}

function eligible(): boolean {
  return passesFieldGuards() && !!field && focused(field) && !composing && !document.hidden;
}

function passesFieldGuards(): boolean {
  if (!settings.enabled || !field) return false;
  if (!isEditableElement(field)) return false;
  if (isBlockedAutoCheckField(fieldInfo(field))) return false;
  return shouldAutoCheck({
    enabled: settings.enabled,
    host: location.hostname,
    disabledHosts: settings.disabledHosts,
    documentHidden: document.hidden,
    trimmedLength: text.trim().length,
    minChars: CONFIG.AUTO_CHECK_MIN_CHARS,
    blocked: false,
    composing: false,
  });
}

function focused(element: HTMLElement): boolean {
  const active = document.activeElement;
  if (active === element) return true;
  return active instanceof Node && element.contains(active);
}

function publish(): void {
  setAutoCheckSnapshot({ field, text, issues });
  setIssueCount(issues.length, issues);
  if (!field || issues.length === 0) {
    clearUnderlines();
    return;
  }
  renderUnderlines(field, text, issues);
}

async function cancelInFlight(): Promise<void> {
  const requestId = activeRequestId;
  if (!requestId) return;
  activeRequestId = null;
  try {
    await browser.runtime.sendMessage({ action: 'cancelGrammarCheck', requestId });
  } catch (error) {
    console.error('[SafeTyper] Failed to cancel an auto-check request:', error);
  }
}

function eventTarget(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  if (!isEditableElement(target)) return null;
  return target;
}

function isOwnUi(event: Event): boolean {
  return event.composedPath().some((node) => {
    if (!(node instanceof Element)) return false;
    return (
      node.classList.contains('safetyper-popup-host') ||
      node.classList.contains('safetyper-icon') ||
      node.classList.contains('safetyper-underline-layer') ||
      node.classList.contains('safetyper-measure')
    );
  });
}

function isCancelled(error: unknown): boolean {
  if (error instanceof GrammarCheckCancelled) return true;
  return error instanceof Error && /cancel/i.test(error.message);
}

function readHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((host): host is string => typeof host === 'string' && host.trim().length > 0);
}

function fieldInfo(element: HTMLElement): AutoCheckFieldInfo {
  const control =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  return {
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : control ? 'textarea' : '',
    hidden: element.hidden || !!element.closest('[hidden]'),
    ariaHidden: element.getAttribute('aria-hidden') === 'true',
    readOnly: control?.readOnly ?? false,
    disabled: control?.disabled ?? false,
    autoComplete: element.getAttribute('autocomplete') || '',
    name: element.getAttribute('name') || '',
    id: element.id || '',
    placeholder: element.getAttribute('placeholder') || '',
    ariaLabel: element.getAttribute('aria-label') || '',
    maxLength: control ? control.maxLength : -1,
    inputMode: element.getAttribute('inputmode') || '',
  };
}
