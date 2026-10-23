/**
 * Start the in-page UI without waiting on the extension service worker.
 * Stylesheet injection used to be awaited first. When that message never
 * settled, focus listeners were never attached, so the icon and the
 * suggestion UI never appeared.
 */

export interface ContentBootPlan {
  /** Ask the background to insert the frame stylesheet. May never settle. */
  injectStyles: () => Promise<void>;
  /** Subscribe to focus, typing, and selection. Must run synchronously. */
  listen: () => void;
  /** Theme and icon size. Failures are reported and do not block the icon. */
  prepareUi: () => Promise<void>;
  /** Show the icon when a field is already focused, including autofocus. */
  revealFocusedField: () => void;
}

export function startContentFeatures(plan: ContentBootPlan): void {
  void plan.injectStyles().catch((error: unknown) => {
    console.error('[SafeTyper] Frame styles were not injected:', error);
  });
  plan.listen();
  plan.revealFocusedField();
  void plan
    .prepareUi()
    .then(() => {
      plan.revealFocusedField();
    })
    .catch((error: unknown) => {
      console.error('[SafeTyper] Could not prepare the in-page UI:', error);
      plan.revealFocusedField();
    });
}
