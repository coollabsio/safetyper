import { describe, expect, it } from 'vitest';
import { classifyIssue } from '../categories';
import {
  applyReplacements,
  chunkParagraphs,
  IssueParseError,
  matchIssues,
  orderForAcceptAll,
  parseIssues,
} from './issues';

function issue(quote: string, replacement: string, category: string, explanation: string) {
  return { quote, replacement, ...classifyIssue({ category }), explanation };
}

describe('chunkParagraphs', () => {
  it('sends each paragraph on its own, even when they would fit together', () => {
    const chunks = chunkParagraphs([
      { id: 'a', text: 'a'.repeat(40) },
      { id: 'b', text: 'b'.repeat(40) },
      { id: 'c', text: 'c'.repeat(40) },
    ]);

    expect(chunks.map((chunk) => chunk.paragraphs.map((paragraph) => paragraph.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('keeps a long paragraph in one chunk', () => {
    const chunks = chunkParagraphs([
      { id: 'short', text: 'Hello.' },
      { id: 'long', text: 'x'.repeat(500) },
      { id: 'after', text: 'Tail.' },
    ]);

    expect(chunks.map((chunk) => chunk.paragraphs.map((paragraph) => paragraph.id))).toEqual([
      ['short'],
      ['long'],
      ['after'],
    ]);
    expect(chunks[1].paragraphs[0].text).toHaveLength(500);
  });

  it('skips empty paragraphs', () => {
    const chunks = chunkParagraphs([
      { id: 'empty', text: '   ' },
      { id: 'real', text: 'A sentence.' },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].paragraphs.map((paragraph) => paragraph.id)).toEqual(['real']);
  });
});

describe('parseIssues', () => {
  const valid = JSON.stringify({
    issues: [
      {
        quote: 'teh',
        replacement: 'the',
        category: 'spelling',
        explanation: 'Spelling.',
      },
    ],
  });

  it('parses a JSON object', () => {
    expect(parseIssues(valid)).toEqual([
      {
        quote: 'teh',
        replacement: 'the',
        ...classifyIssue({ category: 'spelling' }),
        explanation: 'Spelling.',
      },
    ]);
  });

  it('parses JSON wrapped in a markdown fence', () => {
    expect(parseIssues('```json\n' + valid + '\n```')).toHaveLength(1);
  });

  it('drops a no-op where the quote and replacement are the same', () => {
    const raw = JSON.stringify({
      issues: [
        {
          quote: 'fine',
          replacement: 'fine',
          category: 'grammar',
          explanation: 'No change.',
        },
      ],
    });
    expect(parseIssues(raw)).toEqual([]);
  });

  it('rejects prose', () => {
    expect(() => parseIssues('Here are some suggestions.')).toThrow(IssueParseError);
  });

  it('rejects an issue that is missing a required string', () => {
    const raw = JSON.stringify({
      issues: [{ quote: 'teh', replacement: 'the', category: 'spelling' }],
    });
    expect(() => parseIssues(raw)).toThrow(/explanation/);
  });

  it('maps a legacy style category onto engagement', () => {
    const raw = JSON.stringify({
      issues: [
        {
          quote: 'teh',
          replacement: 'the',
          category: 'style',
          explanation: 'Wording.',
        },
      ],
    });
    expect(parseIssues(raw)[0]).toMatchObject({
      group: 'engagement',
      subcategory: 'word-choice',
      category: 'word-choice',
    });
  });

  it('keeps a modern group and subcategory', () => {
    const raw = JSON.stringify({
      issues: [
        {
          quote: 'teh',
          replacement: 'the',
          group: 'delivery',
          subcategory: 'tone',
          explanation: 'Tone.',
        },
      ],
    });
    expect(parseIssues(raw)[0]).toMatchObject({ group: 'delivery', subcategory: 'tone' });
  });

  it('rejects an unknown category', () => {
    const raw = JSON.stringify({
      issues: [
        {
          quote: 'teh',
          replacement: 'the',
          category: 'nope',
          explanation: 'Spelling.',
        },
      ],
    });
    expect(() => parseIssues(raw)).toThrow(IssueParseError);
  });
});

describe('matchIssues', () => {
  const paragraphs = [
    { id: 'p1', text: 'teh cat sat' },
    { id: 'p2', text: 'teh cat sat again' },
  ];

  it('matches an exact quote and drops one that is not in the text', () => {
    const matched = matchIssues(paragraphs, [
      issue('teh', 'the', 'spelling', 'Spelling.'),
      issue('not in the passage', 'missing', 'grammar', 'Invented.'),
    ]);

    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ paragraphId: 'p1', start: 0, end: 3 });
  });

  it('does not assign two issues to the same span', () => {
    const matched = matchIssues(
      [{ id: 'p1', text: 'teh cat' }],
      [
        issue('teh cat', 'the cat', 'spelling', 'Spelling.'),
        issue('teh', 'the', 'spelling', 'Spelling.'),
      ]
    );

    expect(matched.map((issue) => issue.quote)).toEqual(['teh cat']);
  });

  it('matches a repeated quote at the next unused offset', () => {
    const matched = matchIssues(
      [{ id: 'p1', text: 'teh and teh' }],
      [issue('teh', 'the', 'spelling', 'First.'), issue('teh', 'the', 'spelling', 'Second.')]
    );

    expect(matched.map((issue) => issue.start)).toEqual([0, 8]);
  });
});

describe('accept-all ordering', () => {
  it('orders later paragraphs and later offsets first', () => {
    const ordered = orderForAcceptAll([
      { paragraphIndex: 0, start: 5 },
      { paragraphIndex: 1, start: 1 },
      { paragraphIndex: 0, start: 1 },
    ]);

    expect(ordered.map((issue) => [issue.paragraphIndex, issue.start])).toEqual([
      [1, 1],
      [0, 5],
      [0, 1],
    ]);
  });

  it('applies a length-changing earlier edit without moving a later offset', () => {
    const text = 'helllo world';
    const result = applyReplacements(text, [
      { start: 0, end: 6, replacement: 'hello' },
      { start: 7, end: 12, replacement: 'there' },
    ]);

    expect(result).toBe('hello there');
  });
});
