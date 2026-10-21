/**
 * Selection translation content script.
 * Separate from the grammar content script so the two UIs do not share a root.
 */

import '~/assets/fonts/fonts.css';
import { injectFrameStyles, TRANSLATE_FRAME_STYLE } from '~/lib/content/frame-styles';
import { CONTENT_SCRIPT_EXCLUDE_MATCHES, contentScriptShouldStart } from '~/lib/content/page-guard';
import { startSelectionTranslate } from '~/lib/selection-translate/controller';

export default defineContentScript({
  matches: ['<all_urls>'],
  excludeMatches: [...CONTENT_SCRIPT_EXCLUDE_MATCHES],
  allFrames: true,
  matchAboutBlank: false,
  cssInjectionMode: 'manual',
  runAt: 'document_idle',
  async main() {
    if (!contentScriptShouldStart(window, document)) return;
    const marker = window as Window & { __safetyperTranslateBoot?: boolean };
    if (marker.__safetyperTranslateBoot) return;
    marker.__safetyperTranslateBoot = true;
    await injectFrameStyles(TRANSLATE_FRAME_STYLE);
    startSelectionTranslate();
  },
});
