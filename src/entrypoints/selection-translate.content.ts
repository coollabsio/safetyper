/**
 * Selection translation content script.
 * Separate from the grammar content script so the two UIs do not share a root.
 */

import '~/assets/fonts/fonts.css';
import { startSelectionTranslate } from '~/lib/selection-translate/controller';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    startSelectionTranslate();
  },
});
