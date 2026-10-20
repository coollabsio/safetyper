import type { JSONContent } from '@tiptap/core';

export type ImportKind = 'txt' | 'md';

function block(
  type: 'paragraph' | 'heading',
  text: string,
  id: string,
  level?: number
): JSONContent {
  const node: JSONContent = {
    type,
    attrs: type === 'heading' ? { level: level ?? 1, paragraphId: id } : { paragraphId: id },
  };
  if (text.length > 0) {
    node.content = [{ type: 'text', text }];
  }
  return node;
}

function headingLevel(line: string): { level: number; text: string } | null {
  const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { level: match[1].length, text: match[2].trim() };
}

/**
 * Turn plain text or a simple Markdown file into a Tiptap document.
 * Markdown support here is headings and blank-line paragraphs. Rich .docx import is later.
 */
export function importPlainText(text: string, kind: ImportKind): JSONContent {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const content: JSONContent[] = [];
  let next = 0;
  const id = (): string => {
    next += 1;
    return `b${next}`;
  };

  if (kind === 'txt') {
    const lines = normalized.split('\n');
    for (const line of lines) {
      content.push(block('paragraph', line, id()));
    }
  } else {
    const parts = normalized.split(/\n{2,}/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const heading = headingLevel(trimmed);
      if (heading && !trimmed.includes('\n')) {
        content.push(block('heading', heading.text, id(), heading.level));
        continue;
      }
      content.push(block('paragraph', trimmed.replace(/\n+/g, ' '), id()));
    }
  }

  if (content.length === 0) {
    content.push(block('paragraph', '', id()));
  }

  return { type: 'doc', content };
}

export function emptyDocument(): JSONContent {
  return importPlainText('', 'txt');
}

function textOf(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join('');
}

function renderNode(node: JSONContent, kind: ImportKind): string | null {
  if (node.type === 'paragraph') {
    return textOf(node);
  }
  if (node.type === 'heading') {
    const text = textOf(node);
    if (kind === 'txt') return text;
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
    return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
  }
  if (node.type === 'bulletList') {
    return (node.content ?? [])
      .map((item) => `- ${textOf(item).replace(/\n+/g, ' ').trim()}`)
      .join('\n');
  }
  if (node.type === 'orderedList') {
    return (node.content ?? [])
      .map((item, index) => `${index + 1}. ${textOf(item).replace(/\n+/g, ' ').trim()}`)
      .join('\n');
  }
  if (node.type === 'blockquote') {
    const inner = (node.content ?? [])
      .map((child) => renderNode(child, kind))
      .filter((line): line is string => line !== null)
      .join('\n');
    return kind === 'md' ? inner.replace(/^/gm, '> ') : inner;
  }
  if (node.type === 'codeBlock') {
    const code = textOf(node);
    return kind === 'md' ? '```\n' + code + '\n```' : code;
  }
  if (node.type === 'horizontalRule') {
    return kind === 'md' ? '---' : '';
  }
  return null;
}

export function exportDocument(doc: JSONContent, kind: ImportKind): string {
  const blocks = (doc.content ?? [])
    .map((node) => renderNode(node, kind))
    .filter((blockText): blockText is string => blockText !== null);

  if (kind === 'txt') {
    return blocks.join('\n');
  }
  return blocks.join('\n\n');
}
