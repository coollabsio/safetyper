/**
 * Runnable checks for translation prompt, parsing, and error copy.
 * Execute with `bun src/lib/translate/prompt.test.ts`.
 */

import { describeTranslateError } from './errors';
import { defaultTargetFromUiLanguage, languageName } from './languages';
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationPayload,
  isSingleWord,
  parseTranslationResponse,
} from './prompt';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function run(): void {
  assert(TRANSLATION_SYSTEM_PROMPT.includes('line breaks'), 'prompt keeps line breaks');
  assert(TRANSLATION_SYSTEM_PROMPT.includes('proper nouns'), 'prompt keeps proper nouns');
  assert(TRANSLATION_SYSTEM_PROMPT.includes('alternatives'), 'prompt asks for alternatives');
  assert(TRANSLATION_SYSTEM_PROMPT.includes('JSON object'), 'prompt returns only JSON');

  assert(isSingleWord('hello'), 'plain word');
  assert(isSingleWord('  café  '), 'accented word with padding');
  assert(isSingleWord("don't"), 'apostrophe');
  assert(isSingleWord('well-known'), 'hyphenated word');
  assert(!isSingleWord('hello world'), 'two words');
  assert(!isSingleWord('hello!'), 'punctuation');
  assert(!isSingleWord(''), 'empty');
  assert(!isSingleWord('hello\nthere'), 'newline');

  const payload = buildTranslationPayload({
    model: 'mock',
    text: 'Hello Andras,\nThe meeting is at 9.',
    sourceLanguageName: null,
    targetLanguageName: 'Spanish',
    singleWord: false,
  });
  assertEqual(payload.model, 'mock', 'model');
  assertEqual(payload.temperature, 0.2, 'temperature');
  assertEqual(payload.messages[0]?.content, TRANSLATION_SYSTEM_PROMPT, 'system prompt');
  assert(payload.messages[1]?.content.includes('Detect automatically'), 'auto source');
  assert(payload.messages[1]?.content.includes('Target language: Spanish'), 'target');
  assert(payload.messages[1]?.content.includes('Input is a single word: no'), 'sentence flag');
  assert(
    payload.messages[1]?.content.includes('Hello Andras,\nThe meeting is at 9.'),
    'source text'
  );

  const parsed = parseTranslationResponse(
    '```json\n{"translation":"Hola Andras,\\nLa reunión es a las 9.","detectedSourceLanguage":"English","alternatives":[{"text":"Hola","meaning":"hello"}]}\n```'
  );
  assertEqual(parsed.translation, 'Hola Andras,\nLa reunión es a las 9.', 'fenced translation');
  assertEqual(parsed.detectedSourceLanguage, 'English', 'detected language');
  assertEqual(parsed.alternatives.length, 1, 'alternative count');
  assertEqual(parsed.alternatives[0]?.text, 'Hola', 'alternative text');
  assertEqual(parsed.alternatives[0]?.meaning, 'hello', 'alternative meaning');

  const deduped = parseTranslationResponse(
    JSON.stringify({
      translation: 'conjunto',
      detectedSourceLanguage: 'English',
      alternatives: [
        { text: 'conjunto', meaning: 'duplicate of the main translation' },
        { text: 'establecer', meaning: 'to set or establish' },
        'juego',
        { text: '', meaning: 'blank' },
        { text: 'poner', meaning: 'to put' },
        { text: 'fijar', meaning: 'to fix' },
        { text: 'extra', meaning: 'over the limit' },
      ],
    })
  );
  assertEqual(
    deduped.alternatives.map((item) => item.text).join(','),
    'establecer,juego,poner,fijar',
    'alternatives are deduped and capped'
  );

  const plain = parseTranslationResponse('"Hola"');
  assertEqual(plain.translation, 'Hola', 'plain quoted fallback');
  assertEqual(plain.alternatives.length, 0, 'plain fallback has no alternatives');

  const emptyJson = parseTranslationResponse('{"detectedSourceLanguage":"English"}');
  assertEqual(emptyJson.translation, '', 'missing translation does not dump JSON');

  const prose = parseTranslationResponse(
    'Sure! {"translation":"Bonjour","detectedSourceLanguage":"English","alternatives":[]}'
  );
  assertEqual(prose.translation, 'Bonjour', 'JSON embedded in prose');

  assertEqual(defaultTargetFromUiLanguage('en-US'), 'en', 'english region');
  assertEqual(defaultTargetFromUiLanguage('es-MX'), 'es', 'spanish region');
  assertEqual(defaultTargetFromUiLanguage('zh-TW'), 'zh-TW', 'traditional chinese');
  assertEqual(defaultTargetFromUiLanguage('zh'), 'zh-CN', 'generic chinese');
  assertEqual(defaultTargetFromUiLanguage('pt_BR'), 'pt', 'underscore locale');
  assertEqual(defaultTargetFromUiLanguage('xx'), 'en', 'unknown locale');
  assertEqual(languageName('de'), 'German', 'language name');
  assertEqual(languageName('nope'), 'English', 'unknown language name');

  const missingKey = describeTranslateError(new Error('API key not configured'), 'openrouter');
  assert(missingKey.opensSettings, 'missing key opens settings');
  assert(missingKey.message.includes('OpenRouter'), 'missing key names the provider');
  assert(missingKey.message.includes('Settings'), 'missing key points at settings');

  const invalidKey = describeTranslateError(new Error('Invalid Groq API key format'), 'groq');
  assert(invalidKey.opensSettings, 'invalid key opens settings');
  assert(invalidKey.message.includes('Groq'), 'invalid key names the provider');

  const ollama = describeTranslateError(
    new Error('Failed to fetch'),
    'ollama',
    'http://127.0.0.1:11434'
  );
  assert(ollama.opensSettings, 'unreachable ollama opens settings');
  assert(
    ollama.message.includes("Can't reach Ollama at http://127.0.0.1:11434"),
    'ollama error includes the endpoint'
  );

  const forbidden = describeTranslateError(
    new Error('API request failed with status 403: access denied'),
    'ollama',
    'http://127.0.0.1:11434'
  );
  assert(forbidden.opensSettings, 'ollama 403 opens settings');
  assert(forbidden.message.includes('403'), 'ollama 403 mentions the status');
  assert(forbidden.message.includes('Settings'), 'ollama 403 points at settings');

  const hostedForbidden = describeTranslateError(
    new Error('API request failed with status 403'),
    'openrouter'
  );
  assertEqual(hostedForbidden.opensSettings, false, 'hosted 403 stays generic');

  const remoteFetch = describeTranslateError(new Error('Failed to fetch'), 'openrouter');
  assertEqual(remoteFetch.opensSettings, false, 'hosted provider fetch failure stays generic');
  assertEqual(remoteFetch.message, 'Failed to fetch', 'hosted provider message is passed through');

  const limited = describeTranslateError(new Error('Rate limit exceeded.'), 'groq');
  assertEqual(limited.opensSettings, false, 'rate limit does not open settings');
  assert(limited.message.includes('Wait a moment'), 'rate limit copy');
}

run();
