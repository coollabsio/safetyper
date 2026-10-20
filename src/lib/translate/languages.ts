/**
 * Languages offered in the popup translator.
 * Names are sent to the model; codes are what we persist.
 */

export const AUTO_DETECT = 'auto';

export interface LanguageOption {
  code: string;
  name: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'nb', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'el', name: 'Greek' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
];

export function isAutoDetect(code: string): boolean {
  return code === AUTO_DETECT;
}

export function isLanguageCode(code: string): boolean {
  return LANGUAGES.some((language) => language.code === code);
}

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? 'English';
}

/**
 * Default the target to the browser UI language, matching a translator's
 * "translate into my language" behavior. Unknown locales fall back to English.
 */
export function defaultTargetFromUiLanguage(uiLanguage: string): string {
  const normalized = uiLanguage.trim().toLowerCase().replace('_', '-');
  if (!normalized) return 'en';

  const exact = LANGUAGES.find((language) => language.code.toLowerCase() === normalized);
  if (exact) return exact.code;

  const base = normalized.split('-')[0];
  if (base === 'zh') return 'zh-CN';

  const match = LANGUAGES.find((language) => language.code.toLowerCase() === base);
  return match?.code ?? 'en';
}
