/**
 * Underlines for the field that is being checked.
 * Text inputs use an offscreen mirror so the line tracks wrapping and scroll.
 * Contenteditable uses the CSS Custom Highlight API, with positioned lines as a fallback.
 */

import type { SuggestionGroupId } from '../categories';
import { categoryColorVariable, ensureGroupColorVariables } from './category-colors';
import type { Suggestion } from './suggestions';

interface MarkedRange {
  id: string;
  group: SuggestionGroupId;
  range: Range;
}

type CaretPoint = { node: Node; offset: number };

const highlightGroups = new Map<string, Highlight>();

let measure: HTMLDivElement | null = null;
let layer: HTMLDivElement | null = null;
let trackedField: HTMLElement | null = null;
let trackedText = '';
let trackedIssues: Suggestion[] = [];
let usingHighlight = false;
let clickHandler: (issueId: string) => void = () => {};
let fieldClick: ((event: MouseEvent) => void) | null = null;
let fieldScroll: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let listeningToWindow = false;

export function setUnderlineClickHandler(handler: (issueId: string) => void): void {
  clickHandler = handler;
}

export function supportsHighlightApi(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights != null;
}

export function renderUnderlines(field: HTMLElement, text: string, issues: Suggestion[]): void {
  ensureGroupColorVariables();
  if (!field.isConnected || issues.length === 0) {
    clearUnderlines();
    return;
  }
  const sameField = trackedField === field;
  if (!sameField) unbindField();
  trackedField = field;
  trackedText = text;
  trackedIssues = issues;
  ensureWindowListeners();
  bindField(field);

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    usingHighlight = false;
    clearHighlights();
    drawMirror(field, text, issues);
    return;
  }

  clearMirror();
  const marks = rangesForIssues(field, text, issues);
  if (supportsHighlightApi()) {
    usingHighlight = true;
    clearLayer();
    paintHighlights(marks);
    bindEditableClick(field, marks);
    return;
  }
  usingHighlight = false;
  clearHighlights();
  paintRangeBars(field, marks);
}

export function repositionUnderlines(): void {
  if (!trackedField || !trackedField.isConnected || trackedIssues.length === 0) {
    clearUnderlines();
    return;
  }
  if (trackedField instanceof HTMLInputElement || trackedField instanceof HTMLTextAreaElement) {
    if (!measure) drawMirror(trackedField, trackedText, trackedIssues);
    else positionBars(trackedField);
    return;
  }
  if (usingHighlight) return;
  paintRangeBars(trackedField, rangesForIssues(trackedField, trackedText, trackedIssues));
}

export function clearUnderlines(): void {
  unbindField();
  clearMirror();
  clearLayer();
  clearHighlights();
  trackedField = null;
  trackedText = '';
  trackedIssues = [];
  usingHighlight = false;
}

function bindField(field: HTMLElement): void {
  if (fieldScroll) return;
  fieldScroll = () => repositionUnderlines();
  field.addEventListener('scroll', fieldScroll);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => repositionUnderlines());
    resizeObserver.observe(field);
  }
}

function unbindField(): void {
  if (trackedField && fieldScroll) trackedField.removeEventListener('scroll', fieldScroll);
  if (trackedField && fieldClick) trackedField.removeEventListener('click', fieldClick);
  fieldScroll = null;
  fieldClick = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function ensureWindowListeners(): void {
  if (listeningToWindow) return;
  listeningToWindow = true;
  window.addEventListener('scroll', () => repositionUnderlines(), true);
  window.addEventListener('resize', () => repositionUnderlines());
}

function ensureMeasure(): HTMLDivElement {
  if (measure) return measure;
  measure = document.createElement('div');
  measure.className = 'safetyper-measure';
  measure.setAttribute('aria-hidden', 'true');
  document.body.appendChild(measure);
  return measure;
}

function ensureLayer(): HTMLDivElement {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'safetyper-underline-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function clearMirror(): void {
  measure?.remove();
  measure = null;
}

function clearLayer(): void {
  if (layer) layer.replaceChildren();
  layer?.remove();
  layer = null;
}

function drawMirror(
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  issues: Suggestion[]
): void {
  const mirror = ensureMeasure();
  const style = getComputedStyle(field);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const contentWidth = Math.max(0, field.clientWidth - paddingLeft - paddingRight);
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.wordSpacing = style.wordSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textIndent = style.textIndent;
  mirror.style.tabSize = style.tabSize;
  mirror.style.direction = style.direction;
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.overflowWrap = style.overflowWrap;
  mirror.style.whiteSpace =
    field instanceof HTMLInputElement ? 'pre' : style.whiteSpace || 'pre-wrap';
  mirror.style.width = `${contentWidth}px`;
  fillMirror(mirror, text, issues);
  positionBars(field);
}

function fillMirror(mirror: HTMLElement, text: string, issues: Suggestion[]): void {
  mirror.replaceChildren();
  const sorted = [...issues]
    .filter((issue) => text.slice(issue.start, issue.end) === issue.quote)
    .sort((left, right) => left.start - right.start);
  let cursor = 0;
  for (const issue of sorted) {
    if (issue.start < cursor) continue;
    mirror.append(document.createTextNode(text.slice(cursor, issue.start)));
    const mark = document.createElement('span');
    mark.className = 'safetyper-measure-mark';
    mark.dataset.issueId = issue.id;
    mark.dataset.group = issue.group;
    mark.append(document.createTextNode(issue.quote));
    mirror.append(mark);
    cursor = issue.end;
  }
  mirror.append(document.createTextNode(text.slice(cursor)));
}

function positionBars(field: HTMLElement): void {
  if (!measure) return;
  const style = getComputedStyle(field);
  const fieldRect = field.getBoundingClientRect();
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const viewLeft = fieldRect.left + borderLeft;
  const viewTop = fieldRect.top + borderTop;
  const viewRight = viewLeft + field.clientWidth;
  const viewBottom = viewTop + field.clientHeight;
  const originX = viewLeft + paddingLeft - field.scrollLeft;
  const originY = viewTop + paddingTop - field.scrollTop;
  const measureRect = measure.getBoundingClientRect();
  const dx = originX - measureRect.left;
  const dy = originY - measureRect.top;
  const host = placeLayer(viewLeft, viewTop, field.clientWidth, field.clientHeight);
  const marks = measure.querySelectorAll<HTMLElement>('.safetyper-measure-mark');
  marks.forEach((mark) => {
    const id = mark.dataset.issueId || '';
    const group = (mark.dataset.group || 'correctness') as SuggestionGroupId;
    for (const rect of mark.getClientRects()) {
      addBar(
        host,
        rect.left + dx,
        rect.bottom + dy,
        rect.width,
        group,
        id,
        viewLeft,
        viewTop,
        viewRight,
        viewBottom
      );
    }
  });
}

function paintRangeBars(field: HTMLElement, marks: MarkedRange[]): void {
  const fieldRect = field.getBoundingClientRect();
  const host = placeLayer(fieldRect.left, fieldRect.top, fieldRect.width, fieldRect.height);
  for (const mark of marks) {
    for (const rect of mark.range.getClientRects()) {
      addBar(
        host,
        rect.left,
        rect.bottom,
        rect.width,
        mark.group,
        mark.id,
        fieldRect.left,
        fieldRect.top,
        fieldRect.right,
        fieldRect.bottom
      );
    }
  }
  bindEditableClick(field, marks);
}

function placeLayer(left: number, top: number, width: number, height: number): HTMLDivElement {
  const host = ensureLayer();
  host.replaceChildren();
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.width = `${Math.max(0, width)}px`;
  host.style.height = `${Math.max(0, height)}px`;
  return host;
}

function addBar(
  host: HTMLElement,
  left: number,
  bottom: number,
  width: number,
  group: SuggestionGroupId,
  id: string,
  viewLeft: number,
  viewTop: number,
  viewRight: number,
  viewBottom: number
): void {
  const right = left + width;
  const clippedLeft = Math.max(left, viewLeft);
  const clippedRight = Math.min(right, viewRight);
  if (clippedRight - clippedLeft < 1) return;
  if (bottom < viewTop - 1 || bottom > viewBottom + 2) return;
  const bar = document.createElement('div');
  bar.className = 'safetyper-underline-bar';
  bar.dataset.issueId = id;
  bar.style.setProperty('--st-mark', categoryColorVariable(group));
  bar.dataset.group = group;
  bar.style.left = `${clippedLeft - viewLeft}px`;
  bar.style.width = `${clippedRight - clippedLeft}px`;
  bar.style.top = `${bottom - viewTop - 12}px`;
  bar.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  bar.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clickHandler(id);
  });
  host.append(bar);
}

function paintHighlights(marks: MarkedRange[]): void {
  clearHighlights();
  if (!CSS.highlights || typeof Highlight === 'undefined') return;
  for (const mark of marks) {
    const name = `safetyper-${mark.group}`;
    let group = highlightGroups.get(name);
    if (!group) {
      group = new Highlight();
      highlightGroups.set(name, group);
      CSS.highlights.set(name, group);
    }
    group.add(mark.range);
  }
}

function clearHighlights(): void {
  for (const group of highlightGroups.values()) group.clear();
}

function bindEditableClick(field: HTMLElement, marks: MarkedRange[]): void {
  if (fieldClick && trackedField) trackedField.removeEventListener('click', fieldClick);
  fieldClick = (event: MouseEvent) => {
    const point = caretFromPoint(event.clientX, event.clientY);
    if (!point) return;
    const hit = marks.find((mark) => {
      try {
        return mark.range.isPointInRange(point.node, point.offset);
      } catch {
        return false;
      }
    });
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    clickHandler(hit.id);
  };
  field.addEventListener('click', fieldClick);
}

function caretFromPoint(x: number, y: number): CaretPoint | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);
    if (!position) return null;
    return { node: position.offsetNode, offset: position.offset };
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

interface RawSpan {
  node: Text;
  start: number;
  end: number;
}

function rangesForIssues(field: HTMLElement, text: string, issues: Suggestion[]): MarkedRange[] {
  const collected = collectText(field);
  if (!collected.raw) return [];
  const base = collected.raw.indexOf(text);
  const marks: MarkedRange[] = [];
  for (const issue of issues) {
    if (!issue.quote) continue;
    const hint = base === -1 ? issue.start : base + issue.start;
    const index = closestIndex(collected.raw, issue.quote, hint);
    if (index === -1) continue;
    const range = rangeFromOffsets(collected.spans, index, index + issue.quote.length);
    if (!range) continue;
    marks.push({ id: issue.id, group: issue.group, range });
  }
  return marks;
}

function collectText(root: HTMLElement): { raw: string; spans: RawSpan[] } {
  const spans: RawSpan[] = [];
  let raw = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const start = raw.length;
    raw += textNode.data;
    spans.push({ node: textNode, start, end: raw.length });
    current = walker.nextNode();
  }
  return { raw, spans };
}

function closestIndex(text: string, quote: string, hint: number): number {
  let from = 0;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (from <= text.length) {
    const index = text.indexOf(quote, from);
    if (index === -1) break;
    const distance = Math.abs(index - hint);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    from = index + 1;
  }
  return best;
}

function rangeFromOffsets(spans: RawSpan[], start: number, end: number): Range | null {
  const startPoint = pointAt(spans, start);
  const endPoint = pointAt(spans, end);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function pointAt(spans: RawSpan[], offset: number): { node: Text; offset: number } | null {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const last = index === spans.length - 1;
    if (offset < span.start) return null;
    if (offset < span.end || (last && offset === span.end)) {
      return { node: span.node, offset: Math.min(span.node.data.length, offset - span.start) };
    }
  }
  return null;
}
