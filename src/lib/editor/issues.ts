/**
 * Paragraph chunking, suggestion JSON, and quote matching for the editor.
 * These functions stay free of the DOM and of provider calls so they can be tested on their own.
 */

export const ISSUE_CATEGORIES = ['grammar', 'spelling', 'punctuation', 'clarity', 'other'] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export interface GrammarIssue {
  quote: string;
  replacement: string;
  category: IssueCategory;
  explanation: string;
}

export interface ParagraphInput {
  id: string;
  text: string;
}

export interface TextChunk {
  id: string;
  paragraphs: ParagraphInput[];
}

export interface MatchedIssue extends GrammarIssue {
  paragraphId: string;
  paragraphIndex: number;
  start: number;
  end: number;
}

export interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

export class IssueParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueParseError';
  }
}

export const ISSUE_SYSTEM_PROMPT = [
  'You are a proofreading assistant. Find grammar, spelling, and punctuation problems in the passage.',
  'Reply with one JSON object and nothing else:',
  '{"issues":[{"quote":"exact substring from the passage","replacement":"corrected substring","category":"grammar|spelling|punctuation|clarity|other","explanation":"one short sentence"}]}',
  'Rules:',
  '- quote is a short exact copy from the passage, usually two to six words. Do not quote a whole sentence.',
  '- replacement is only those words, corrected.',
  '- Return at most 6 issues.',
  '- If nothing is wrong, return {"issues":[]}.',
  '- Do not translate. Keep the language of the passage.',
  '- Do not wrap the JSON in markdown.',
].join('\n');

/**
 * One paragraph per request. Small models stay reliable when the passage is short.
 * Empty paragraphs are skipped. A long paragraph is not split, so quote offsets still
 * refer to that paragraph.
 */
export function chunkParagraphs(paragraphs: ParagraphInput[]): TextChunk[] {
  return paragraphs
    .filter((paragraph) => paragraph.text.trim().length > 0)
    .map((paragraph) => ({
      id: paragraph.id,
      paragraphs: [{ id: paragraph.id, text: paragraph.text }],
    }));
}

export function chunkText(chunk: TextChunk): string {
  return chunk.paragraphs.map((paragraph) => paragraph.text).join('\n\n');
}

/**
 * Pull the JSON object out of a model reply. Fences and a short preamble are tolerated.
 * Anything that is not one JSON object throws, so the caller can retry once.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new IssueParseError('The model reply did not contain a JSON object.');
  }
  return body.slice(start, end + 1);
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string') {
    throw new IssueParseError(`Issue ${index + 1} is missing a string ${field}.`);
  }
  return value;
}

function requireCategory(value: unknown, index: number): IssueCategory {
  if (typeof value !== 'string' || !ISSUE_CATEGORIES.includes(value as IssueCategory)) {
    throw new IssueParseError(
      `Issue ${index + 1} has a category other than ${ISSUE_CATEGORIES.join(', ')}.`
    );
  }
  return value as IssueCategory;
}

export function parseIssues(raw: string): GrammarIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    if (error instanceof IssueParseError) throw error;
    throw new IssueParseError('The model reply was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || !('issues' in parsed)) {
    throw new IssueParseError('The JSON object did not contain an issues array.');
  }

  const issues = (parsed as { issues: unknown }).issues;
  if (!Array.isArray(issues)) {
    throw new IssueParseError('The JSON object did not contain an issues array.');
  }

  const result: GrammarIssue[] = [];
  issues.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new IssueParseError(`Issue ${index + 1} is not an object.`);
    }
    const record = item as Record<string, unknown>;
    const quote = requireString(record.quote, 'quote', index);
    const replacement = requireString(record.replacement, 'replacement', index);
    const explanation = requireString(record.explanation, 'explanation', index);
    const category = requireCategory(record.category, index);
    if (quote.trim().length === 0) {
      throw new IssueParseError(`Issue ${index + 1} has an empty quote.`);
    }
    if (quote === replacement) return;
    result.push({ quote, replacement, category, explanation });
  });
  return result;
}

function rangesOverlap(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([usedStart, usedEnd]) => start < usedEnd && end > usedStart);
}

function findUnused(text: string, quote: string, ranges: Array<[number, number]>): number {
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(quote, from);
    if (start === -1) return -1;
    const end = start + quote.length;
    if (!rangesOverlap(start, end, ranges)) return start;
    from = start + 1;
  }
  return -1;
}

/**
 * Keep issues whose quote appears in one of the paragraphs. Unmatched quotes are dropped.
 * A quote that appears twice can match twice. Overlapping spans in the same paragraph are dropped.
 */
export function matchIssues(paragraphs: ParagraphInput[], issues: GrammarIssue[]): MatchedIssue[] {
  const used = new Map<string, Array<[number, number]>>();
  const matched: MatchedIssue[] = [];

  for (const issue of issues) {
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index];
      const ranges = used.get(paragraph.id) ?? [];
      const start = findUnused(paragraph.text, issue.quote, ranges);
      if (start === -1) continue;
      const end = start + issue.quote.length;
      ranges.push([start, end]);
      used.set(paragraph.id, ranges);
      matched.push({
        ...issue,
        paragraphId: paragraph.id,
        paragraphIndex: index,
        start,
        end,
      });
      break;
    }
  }

  return matched;
}

export function issueKey(issue: Pick<MatchedIssue, 'paragraphId' | 'start' | 'quote'>): string {
  return `${issue.paragraphId}:${issue.start}:${issue.quote}`;
}

/**
 * Later spans first, and later paragraphs first, so an earlier replacement cannot move a later offset.
 */
export function orderForAcceptAll<T extends { paragraphIndex: number; start: number }>(
  issues: T[]
): T[] {
  return issues.slice().sort((a, b) => b.paragraphIndex - a.paragraphIndex || b.start - a.start);
}

export function applyReplacements(text: string, issues: Replacement[]): string {
  const ordered = issues.slice().sort((a, b) => b.start - a.start || b.end - a.end);
  let next = text;
  for (const issue of ordered) {
    next = next.slice(0, issue.start) + issue.replacement + next.slice(issue.end);
  }
  return next;
}

/** Remembers the paragraph text from the last check so only dirty paragraphs are sent again. */
export class ParagraphSnapshot {
  private texts: Record<string, string> = {};

  replace(blocks: Array<{ id: string; text: string }>): void {
    const next: Record<string, string> = {};
    for (const block of blocks) next[block.id] = block.text;
    this.texts = next;
  }

  remember(id: string, text: string): void {
    this.texts[id] = text;
  }

  dirtyIds(blocks: Array<{ id: string; text: string }>): string[] {
    const dirty: string[] = [];
    for (const block of blocks) {
      if (this.texts[block.id] !== block.text) dirty.push(block.id);
    }
    return dirty;
  }
}

export interface ReadabilityStats {
  words: number;
  characters: number;
  sentences: number;
  flesch: number | null;
}

function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return 0;
  const groups = letters.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  if (letters.endsWith('e') && count > 1) count -= 1;
  return Math.max(1, count);
}

/** Word count, character count, and Flesch reading ease. Local only. */
export function readabilityStats(text: string): ReadabilityStats {
  const characters = text.length;
  const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
  const sentences = text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (words.length === 0 || sentences.length === 0) {
    return { words: words.length, characters, sentences: sentences.length, flesch: null };
  }

  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const flesch =
    206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return {
    words: words.length,
    characters,
    sentences: sentences.length,
    flesch: Math.round(flesch * 10) / 10,
  };
}
