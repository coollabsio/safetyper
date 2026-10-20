/**
 * Context-menu and command ids for translating the current selection.
 * The parent item is the label people see; the first child runs the saved target language.
 */

export const TRANSLATE_PARENT_ID = 'safetyper-translate';
export const TRANSLATE_ACTION_ID = 'safetyper-translate-to-target';
export const TRANSLATE_CHANGE_LANGUAGE_ID = 'safetyper-translate-change-language';

export const TRANSLATE_PARENT_TITLE = 'Translate with SafeTyper';
export const CHANGE_LANGUAGE_TITLE = 'Change language…';
export const TRANSLATE_COMMAND = 'translate-selection';
export const SELECTION_TRANSLATE_PORT = 'safetyper-selection-translate';

export const OPEN_TRANSLATE_TAB_ACTION = 'safetyper:open-translate-tab';
export const OPEN_SETTINGS_ACTION = 'safetyper:open-settings';

/** Chrome treats a single & as an access key, so a literal ampersand is doubled. */
export function escapeMenuMnemonic(title: string): string {
  return title.replaceAll('&', '&&');
}

export function translateTargetMenuTitle(languageName: string): string {
  return escapeMenuMnemonic(`Translate to ${languageName}`);
}
