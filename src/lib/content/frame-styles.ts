/**
 * Styles stay out of the manifest so they are not pushed into every frame.
 * The content script asks for them only after the frame guard allows the page.
 */

import { browser } from 'wxt/browser';
import { CONTENT_FRAME_STYLE, isFrameStyleFile, TRANSLATE_FRAME_STYLE } from './page-guard';

export { CONTENT_FRAME_STYLE, TRANSLATE_FRAME_STYLE };

export async function injectFrameStyles(file: string): Promise<void> {
  if (!isFrameStyleFile(file)) {
    console.error('[SafeTyper] Refusing to inject an unknown stylesheet:', file);
    return;
  }
  try {
    const response = (await browser.runtime.sendMessage({
      action: 'injectFrameStyles',
      file,
    })) as { success?: boolean; error?: string } | undefined;
    if (!response || response.success !== true) {
      console.error(
        '[SafeTyper] Frame styles were not injected:',
        response?.error ?? 'no response'
      );
    }
  } catch (error) {
    console.error('[SafeTyper] Failed to inject frame styles:', error);
  }
}
