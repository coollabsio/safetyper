/**
 * Frame and field guards that keep SafeTyper off captcha widgets and login forms.
 * Execute with `bun src/lib/content/page-guard.test.ts`.
 */

import {
  CONTENT_FRAME_STYLE,
  CONTENT_SCRIPT_EXCLUDE_MATCHES,
  controlSignalsAreProtected,
  EDITOR_INPUT_MIN_HEIGHT,
  EDITOR_INPUT_MIN_WIDTH,
  excludeMatchCovers,
  formLooksLikeAuth,
  isBlockedFrameUrl,
  isCaptchaResponseName,
  isFrameStyleFile,
  isOtpFieldName,
  sameMatchList,
  shouldRunContentScript,
  snapshotLooksLikeEditor,
  TRANSLATE_FRAME_STYLE,
  type ControlSignals,
  type EditorSnapshot,
} from './page-guard';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function control(partial: Partial<ControlSignals>): ControlSignals {
  return {
    tagName: 'INPUT',
    type: 'text',
    hidden: false,
    autoComplete: '',
    name: '',
    id: '',
    inAuthForm: false,
    ...partial,
  };
}

function run(): void {
  const turnstile =
    'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/abc/1x00000000000000000000AA/auto/fbE/new/normal?lang=auto';
  assert(isBlockedFrameUrl(turnstile), 'turnstile challenge frame is blocked');
  assert(excludeMatchCovers(turnstile), 'turnstile challenge frame is excluded in the manifest');
  assert(
    isBlockedFrameUrl('https://extra.challenges.cloudflare.com/cdn-cgi/challenge-platform/'),
    'challenge subdomains are blocked'
  );

  assert(
    isBlockedFrameUrl('https://newassets.hcaptcha.com/captcha/v1/static/hcaptcha.html'),
    'hcaptcha asset frame'
  );
  assert(isBlockedFrameUrl('https://hcaptcha.com/captcha/v1'), 'hcaptcha apex frame');
  assert(
    isBlockedFrameUrl('https://www.google.com/recaptcha/api2/anchor?k=site'),
    'recaptcha anchor frame'
  );
  assert(
    isBlockedFrameUrl('https://www.google.com/recaptcha/enterprise/anchor'),
    'recaptcha enterprise frame'
  );
  assert(
    isBlockedFrameUrl('https://www.recaptcha.net/recaptcha/api2/bframe'),
    'recaptcha.net frame'
  );
  assert(
    isBlockedFrameUrl('https://recaptcha.google.com/recaptcha/enterprise/anchor'),
    'recaptcha.google.com frame'
  );
  assert(
    isBlockedFrameUrl('https://js.stripe.com/v3/elements-inner-payment.html'),
    'stripe elements frame'
  );
  assert(isBlockedFrameUrl('https://hooks.stripe.com/redirect/complete'), 'stripe hooks frame');
  assert(isBlockedFrameUrl('https://m.stripe.network/inner.html'), 'stripe radar frame');
  assert(isBlockedFrameUrl('https://client-api.arkoselabs.com/fc/gt2/public_key/'), 'arkose frame');
  assert(isBlockedFrameUrl('https://api.funcaptcha.com/fc/gc/'), 'funcaptcha frame');

  assert(
    !isBlockedFrameUrl('https://dash.cloudflare.com/login'),
    'cloudflare dashboard stays available'
  );
  assert(
    !isBlockedFrameUrl('https://www.google.com/search?q=recaptcha'),
    'google search stays available'
  );
  assert(!isBlockedFrameUrl('https://mail.google.com/mail/u/0/'), 'gmail stays available');
  assert(
    !isBlockedFrameUrl('https://dashboard.stripe.com/test/payments'),
    'stripe dashboard stays available'
  );
  assert(
    !isBlockedFrameUrl('https://example.com/recaptcha-article'),
    'unrelated hosts stay available'
  );
  assert(!isBlockedFrameUrl('about:blank'), 'about:blank is not a captcha url');

  for (const pattern of CONTENT_SCRIPT_EXCLUDE_MATCHES) {
    assert(pattern.startsWith('*://'), `${pattern} is a match pattern`);
    assert(!pattern.includes('<all_urls>'), 'exclude list does not restate all urls');
  }
  assert(
    CONTENT_SCRIPT_EXCLUDE_MATCHES.includes('*://challenges.cloudflare.com/*'),
    'cloudflare challenges are excluded'
  );
  assert(
    CONTENT_SCRIPT_EXCLUDE_MATCHES.includes('*://*.hcaptcha.com/*'),
    'hcaptcha subdomains are excluded'
  );
  assert(
    CONTENT_SCRIPT_EXCLUDE_MATCHES.includes('*://*.google.com/recaptcha/*'),
    'google recaptcha paths are excluded'
  );
  assert(CONTENT_SCRIPT_EXCLUDE_MATCHES.includes('*://js.stripe.com/*'), 'stripe js is excluded');
  assert(
    CONTENT_SCRIPT_EXCLUDE_MATCHES.includes('*://hooks.stripe.com/*'),
    'stripe hooks are excluded'
  );
  assert(
    sameMatchList(CONTENT_SCRIPT_EXCLUDE_MATCHES, [...CONTENT_SCRIPT_EXCLUDE_MATCHES].reverse()),
    'exclude lists compare as a set'
  );
  assert(
    !sameMatchList(undefined, CONTENT_SCRIPT_EXCLUDE_MATCHES),
    'a missing exclude list is stale'
  );

  assert(isFrameStyleFile(CONTENT_FRAME_STYLE), 'grammar stylesheet is allowed');
  assert(isFrameStyleFile(TRANSLATE_FRAME_STYLE), 'translate stylesheet is allowed');
  assert(
    !isFrameStyleFile('content-scripts/../background.js'),
    'other extension files are refused'
  );
  assert(!isFrameStyleFile('https://example.com/content.css'), 'remote stylesheets are refused');

  assert(controlSignalsAreProtected(control({ type: 'password' })), 'password input');
  assert(controlSignalsAreProtected(control({ type: 'hidden' })), 'hidden input');
  assert(controlSignalsAreProtected(control({ hidden: true })), 'hidden attribute');
  assert(
    controlSignalsAreProtected(control({ autoComplete: 'username' })),
    'username autocomplete'
  );
  assert(
    controlSignalsAreProtected(control({ autoComplete: 'section-login username' })),
    'sectioned username autocomplete'
  );
  assert(
    controlSignalsAreProtected(control({ autoComplete: 'current-password', type: 'text' })),
    'revealed current password'
  );
  assert(
    controlSignalsAreProtected(control({ autoComplete: 'new-password' })),
    'new password autocomplete'
  );
  assert(
    controlSignalsAreProtected(control({ autoComplete: 'one-time-code' })),
    'one-time code autocomplete'
  );
  assert(controlSignalsAreProtected(control({ name: 'otp' })), 'otp name');
  assert(controlSignalsAreProtected(control({ id: 'user_otp' })), 'otp id');
  assert(controlSignalsAreProtected(control({ name: 'one-time-code' })), 'one-time-code name');
  assert(
    controlSignalsAreProtected(control({ name: 'cf-turnstile-response', type: 'hidden' })),
    'turnstile response'
  );
  assert(
    controlSignalsAreProtected(
      control({ tagName: 'TEXTAREA', type: '', name: 'g-recaptcha-response' })
    ),
    'recaptcha response textarea'
  );
  assert(
    controlSignalsAreProtected(control({ name: 'h-captcha-response', type: 'hidden' })),
    'hcaptcha response'
  );
  assert(
    controlSignalsAreProtected(control({ inAuthForm: true, name: 'email' })),
    'field in an auth form'
  );
  assert(
    !controlSignalsAreProtected(control({ name: 'message' })),
    'a message field stays available'
  );
  assert(!controlSignalsAreProtected(control({ id: 'footnote' })), 'footnote is not an otp field');
  assert(!controlSignalsAreProtected(control({ name: 'hotpot' })), 'hotpot is not an otp field');
  assert(!isOtpFieldName('footnote'), 'otp helper ignores footnote');
  assert(isCaptchaResponseName('cf-turnstile-response'), 'turnstile name helper');

  const loginForm = [
    control({ type: 'text', autoComplete: 'username', name: 'email' }),
    control({ type: 'password', autoComplete: 'current-password', name: 'password' }),
    control({ type: 'hidden', name: 'cf-turnstile-response' }),
  ];
  assert(formLooksLikeAuth(loginForm), 'a password form is an auth form');
  assert(
    controlSignalsAreProtected({ ...loginForm[0], inAuthForm: true }),
    'username in a password form is protected'
  );

  const contactForm = [
    control({ tagName: 'TEXTAREA', type: '', name: 'message' }),
    control({ type: 'hidden', name: 'cf-turnstile-response' }),
  ];
  assert(
    !formLooksLikeAuth(contactForm),
    'a turnstile token does not make a contact form an auth form'
  );
  assert(
    !controlSignalsAreProtected({ ...contactForm[0], inAuthForm: false }),
    'the contact message stays available'
  );
  assert(
    controlSignalsAreProtected(contactForm[1]),
    'the contact form token itself stays protected'
  );

  const otpForm = [control({ name: 'otp-code', type: 'text' }), control({ name: 'notes' })];
  assert(formLooksLikeAuth(otpForm), 'an otp field makes the form an auth form');

  assert(
    !shouldRunContentScript({
      href: turnstile,
      topFrame: false,
      sameOriginAncestors: false,
      editorDocument: false,
    }),
    'captcha frame does not run'
  );
  assert(
    !shouldRunContentScript({
      href: turnstile,
      topFrame: true,
      sameOriginAncestors: true,
      editorDocument: true,
    }),
    'a captcha url does not run even as the top document'
  );
  assert(
    shouldRunContentScript({
      href: 'https://dash.cloudflare.com/login',
      topFrame: true,
      sameOriginAncestors: true,
      editorDocument: false,
    }),
    'the login page itself still loads the script'
  );
  assert(
    shouldRunContentScript({
      href: 'https://mail.google.com/mail/u/0/',
      topFrame: false,
      sameOriginAncestors: true,
      editorDocument: false,
    }),
    'same-origin editor iframes still run before the editor mounts'
  );
  assert(
    !shouldRunContentScript({
      href: 'https://cdn.example.com/widget.html',
      topFrame: false,
      sameOriginAncestors: false,
      editorDocument: false,
    }),
    'a cross-origin widget frame does not run'
  );
  assert(
    shouldRunContentScript({
      href: 'https://cdn.example.com/editor.html',
      topFrame: false,
      sameOriginAncestors: false,
      editorDocument: true,
    }),
    'a cross-origin editor document still runs'
  );

  const bare: EditorSnapshot = {
    bodyEditable: false,
    hasContentEditable: false,
    textareas: [],
    textInputs: [],
  };
  assert(!snapshotLooksLikeEditor(bare), 'an empty widget is not an editor');
  assert(
    snapshotLooksLikeEditor({ ...bare, hasContentEditable: true }),
    'a contenteditable document is an editor'
  );
  assert(
    snapshotLooksLikeEditor({
      ...bare,
      textareas: [control({ tagName: 'TEXTAREA', type: '', name: 'body' })],
    }),
    'a textarea document is an editor'
  );
  assert(
    !snapshotLooksLikeEditor({
      ...bare,
      textareas: [control({ tagName: 'TEXTAREA', type: '', name: 'g-recaptcha-response' })],
    }),
    'a recaptcha response textarea is not an editor'
  );
  assert(
    snapshotLooksLikeEditor({
      ...bare,
      textInputs: [
        {
          signals: control({ name: 'title' }),
          width: EDITOR_INPUT_MIN_WIDTH,
          height: EDITOR_INPUT_MIN_HEIGHT,
        },
      ],
    }),
    'a large text input counts as an editor'
  );
  assert(
    !snapshotLooksLikeEditor({
      ...bare,
      textInputs: [
        {
          signals: control({ name: 'q' }),
          width: EDITOR_INPUT_MIN_WIDTH - 1,
          height: EDITOR_INPUT_MIN_HEIGHT,
        },
      ],
    }),
    'a small input does not make a frame an editor'
  );
  assert(
    !snapshotLooksLikeEditor({
      ...bare,
      textInputs: [
        {
          signals: control({ autoComplete: 'username', inAuthForm: true }),
          width: 320,
          height: 40,
        },
      ],
    }),
    'a cross-origin login form is not an editor'
  );
}

run();
console.log('page guard tests passed');
