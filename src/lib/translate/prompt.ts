/**
 * Prompt and response parsing for popup translation.
 * The model is asked for JSON so a single word can carry alternatives
 * without extra commentary leaking into the translation itself.
 */

import type { OpenRouterRequestPayload } from '../content/types';
import type { TranslationAlternative, TranslationResult } from './types';

export const TRANSLATION_TEMPERATURE = 0.2;

export const TRANSLATION_SYSTEM_PROMPT = `You are a translation engine. Return only a JSON object, with no markdown fences and no commentary.

Rules:
- Put the translation in "translation". Preserve the original formatting exactly, including line breaks, paragraphs, lists, indentation, and spacing.
- Keep proper nouns (people, places, brands, and product names) unchanged, unless the target language has a standard exonym.
- Do not explain the translation, and do not wrap it in quotation marks.
- "detectedSourceLanguage" is the English name of the language the input is written in.
- "alternatives" is an array of up to 4 other natural translations. Each item is {"text","meaning"}, and "meaning" is a short English gloss. For a sentence or anything longer, return []. For a single word, when the user message says the input is a single word, include a few distinct meanings or common alternatives.

Schema:
{"translation":"string","detectedSourceLanguage":"string","alternatives":[{"text":"string","meaning":"string"}]}`;

const MAX_ALTERNATIVES = 4;

export function isSingleWord(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/u.test(trimmed)) return false;
  return /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(trimmed);
}

export function buildTranslationPayload(options: {
  model: string;
  text: string;
  sourceLanguageName: string | null;
  targetLanguageName: string;
  singleWord: boolean;
}): OpenRouterRequestPayload {
  const source = options.sourceLanguageName ?? 'Detect automatically';
  const user = [
    `Source language: ${source}`,
    `Target language: ${options.targetLanguageName}`,
    `Input is a single word: ${options.singleWord ? 'yes' : 'no'}`,
    '',
    'Text:',
    options.text,
  ].join('\n');

  return {
    model: options.model,
    temperature: TRANSLATION_TEMPERATURE,
    response_format: { type: 'text' },
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
  };
}

export function parseTranslationResponse(raw: string): TranslationResult {
  const stripped = stripFences(raw);
  const jsonSlice = extractJsonObject(stripped);

  if (jsonSlice) {
    try {
      const parsed = readResult(JSON.parse(jsonSlice) as unknown);
      if (parsed) return parsed;
      if (stripped.trim().startsWith('{')) {
        return { translation: '', detectedSourceLanguage: null, alternatives: [] };
      }
    } catch {
      // The model ignored the JSON shape. Show the text itself.
    }
  }

  return {
    translation: unwrapQuotes(stripped),
    detectedSourceLanguage: null,
    alternatives: [],
  };
}

function stripFences(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

function unwrapQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readResult(value: unknown): TranslationResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const translation = readString(record.translation);
  if (translation === null) return null;

  const detected = readString(record.detectedSourceLanguage);

  return {
    translation,
    detectedSourceLanguage: detected,
    alternatives: normalizeAlternatives(record.alternatives, translation),
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value;
}

function normalizeAlternatives(value: unknown, translation: string): TranslationAlternative[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>([translation.trim().toLowerCase()]);
  const alternatives: TranslationAlternative[] = [];

  for (const item of value) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;

    let text = '';
    let meaning = '';
    if (typeof item === 'string') {
      text = item.trim();
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      text = readString(record.text)?.trim() ?? '';
      meaning = readString(record.meaning)?.trim() ?? '';
    }

    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    alternatives.push({ text, meaning });
  }

  return alternatives;
}
