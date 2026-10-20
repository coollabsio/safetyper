import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { issueKey, type MatchedIssue } from './issues';

export interface TextBlock {
  id: string;
  text: string;
  from: number;
  to: number;
}

export function collectBlocks(doc: PMNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    const id = node.attrs.paragraphId;
    if (typeof id !== 'string' || id.length === 0) return;
    blocks.push({
      id,
      text: node.textContent,
      from: pos + 1,
      to: pos + node.nodeSize - 1,
    });
  });
  return blocks;
}

export function locateIssue(
  blocks: TextBlock[],
  issue: MatchedIssue
): { from: number; to: number } | null {
  const block = blocks.find((candidate) => candidate.id === issue.paragraphId);
  if (!block) return null;
  const start = block.text.indexOf(issue.quote);
  if (start === -1) return null;
  return { from: block.from + start, to: block.from + start + issue.quote.length };
}

function newParagraphId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Stable ids on paragraphs and headings so a recheck can target one block. */
export const ParagraphIds = Extension.create({
  name: 'paragraphIds',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          paragraphId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-paragraph-id'),
            renderHTML: (attributes) => {
              const id = attributes.paragraphId;
              if (typeof id !== 'string' || id.length === 0) return {};
              return { 'data-paragraph-id': id };
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
            const id = node.attrs.paragraphId;
            if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const nextId = newParagraphId();
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, paragraphId: nextId });
            seen.add(nextId);
            changed = true;
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});

export interface SuggestionHandlers {
  issues: MatchedIssue[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const suggestionKey = new PluginKey('safetyperSuggestions');

export function createSuggestionExtension(handlers: SuggestionHandlers) {
  return Extension.create({
    name: 'safetyperSuggestions',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: suggestionKey,
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              const blocks = collectBlocks(state.doc);
              for (const issue of handlers.issues) {
                const range = locateIssue(blocks, issue);
                if (!range || range.from >= range.to) continue;
                const key = issueKey(issue);
                decorations.push(
                  Decoration.inline(range.from, range.to, {
                    class: [
                      'safetyper-issue',
                      `safetyper-issue-${issue.group}`,
                      key === handlers.activeKey ? 'is-active' : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                  })
                );
              }
              return DecorationSet.create(state.doc, decorations);
            },
            handleClick(view, pos) {
              const blocks = collectBlocks(view.state.doc);
              const hit = handlers.issues.find((issue) => {
                const range = locateIssue(blocks, issue);
                return range !== null && pos >= range.from && pos <= range.to;
              });
              if (!hit) return false;
              handlers.onSelect(issueKey(hit));
              return true;
            },
            handleKeyDown(_view, event) {
              if (event.key === 'Tab') return false;
              return handlers.onKeyDown(event);
            },
          },
        }),
      ];
    },
  });
}
