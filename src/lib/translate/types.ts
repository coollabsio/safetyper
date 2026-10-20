/**
 * Translation result shown in the popup.
 */

export interface TranslationAlternative {
  text: string;
  meaning: string;
}

export interface TranslationResult {
  translation: string;
  detectedSourceLanguage: string | null;
  alternatives: TranslationAlternative[];
}
