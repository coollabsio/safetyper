/**
 * Decide where the content scripts are allowed to run.
 * Captcha and payment frames treat injected stylesheets and DOM edits as tampering.
 * Login fields are left untouched so a grammar icon never wraps or annotates them.
 */

export interface BlockedFrame {
  host: string;
  /** Also match hosts that end with `.<host>`. The exact host is always matched. */
  subdomains: boolean;
  /** When set, only this path and its children are blocked. */
  pathPrefix?: string;
}

/**
 * Hosts whose documents are widgets, not pages the user edits.
 * Path prefixes keep ordinary Google pages available.
 */
export const BLOCKED_FRAMES: readonly BlockedFrame[] = [
  { host: 'challenges.cloudflare.com', subdomains: true },
  { host: 'hcaptcha.com', subdomains: true },
  { host: 'google.com', subdomains: true, pathPrefix: '/recaptcha' },
  { host: 'recaptcha.net', subdomains: true },
  { host: 'recaptcha.google.com', subdomains: true },
  { host: 'js.stripe.com', subdomains: true },
  { host: 'hooks.stripe.com', subdomains: true },
  { host: 'stripe.network', subdomains: true },
  { host: 'arkoselabs.com', subdomains: true },
  { host: 'funcaptcha.com', subdomains: true },
];

function matchPatternsFor(block: BlockedFrame): string[] {
  const path = block.pathPrefix ? `${block.pathPrefix}/*` : '/*';
  const hosts = block.subdomains ? [`*.${block.host}`, block.host] : [block.host];
  return hosts.map((host) => `*://${host}${path}`);
}

/** Manifest `exclude_matches` for every content script that would otherwise use `<all_urls>`. */
export const CONTENT_SCRIPT_EXCLUDE_MATCHES: readonly string[] =
  BLOCKED_FRAMES.flatMap(matchPatternsFor);

export function sameMatchList(
  left: readonly string[] | undefined,
  right: readonly string[]
): boolean {
  if ((left?.length ?? 0) !== right.length) return false;
  const sortedLeft = [...(left ?? [])].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((item, index) => item === sortedRight[index]);
}

export const CONTENT_FRAME_STYLE = 'content-scripts/content.css';
export const TRANSLATE_FRAME_STYLE = 'content-scripts/selection-translate.css';

const FRAME_STYLE_FILES: readonly string[] = [CONTENT_FRAME_STYLE, TRANSLATE_FRAME_STYLE];

export function isFrameStyleFile(file: string): boolean {
  return FRAME_STYLE_FILES.includes(file);
}

export function isBlockedFrameUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname || '/';
  return BLOCKED_FRAMES.some(
    (block) => hostMatches(hostname, block) && pathMatches(pathname, block.pathPrefix)
  );
}

function hostMatches(hostname: string, block: BlockedFrame): boolean {
  if (hostname === block.host) return true;
  return block.subdomains && hostname.endsWith(`.${block.host}`);
}

function pathMatches(pathname: string, pathPrefix: string | undefined): boolean {
  if (!pathPrefix) return true;
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

/** True when one generated exclude pattern covers this http(s) URL. */
export function excludeMatchCovers(href: string): boolean {
  return CONTENT_SCRIPT_EXCLUDE_MATCHES.some((pattern) => matchPatternCovers(pattern, href));
}

export function matchPatternCovers(pattern: string, href: string): boolean {
  const parsed = /^\*:\/\/(\*\.)?([^/]+)(\/.*)$/.exec(pattern);
  if (!parsed) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const wildcard = Boolean(parsed[1]);
  const host = parsed[2].toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const hostOk = hostname === host || (wildcard && hostname.endsWith(`.${host}`));
  if (!hostOk) return false;
  const path = parsed[3];
  if (path === '/*') return true;
  const prefix = path.endsWith('/*') ? path.slice(0, -1) : path;
  return url.pathname.startsWith(prefix);
}

export interface ControlSignals {
  tagName: string;
  type: string;
  hidden: boolean;
  autoComplete: string;
  name: string;
  id: string;
  /** True when the control belongs to a login, password, or one-time-code form. */
  inAuthForm: boolean;
}

const PROTECTED_AUTOCOMPLETE = new Set([
  'username',
  'current-password',
  'new-password',
  'one-time-code',
]);

const CAPTCHA_RESPONSE_NAMES = [
  'cf-turnstile-response',
  'g-recaptcha-response',
  'h-captcha-response',
];

export function autocompleteTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function hasProtectedAutocomplete(value: string): boolean {
  return autocompleteTokens(value).some((token) => PROTECTED_AUTOCOMPLETE.has(token));
}

export function isCaptchaResponseName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return CAPTCHA_RESPONSE_NAMES.some((name) => normalized.includes(name));
}

export function isOtpFieldName(value: string): boolean {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes('otp') || tokens.includes('onetimecode')) return true;
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index] === 'one' && tokens[index + 1] === 'time' && tokens[index + 2] === 'code') {
      return true;
    }
  }
  return false;
}

export function isPasswordType(tagName: string, type: string): boolean {
  return tagName.toUpperCase() === 'INPUT' && type.toLowerCase() === 'password';
}

export function isHiddenInputType(tagName: string, type: string): boolean {
  return tagName.toUpperCase() === 'INPUT' && type.toLowerCase() === 'hidden';
}

/** Signals that make the whole form off limits, not just the matching control. */
export function signalsLookLikeAuth(
  control: Pick<ControlSignals, 'tagName' | 'type' | 'autoComplete' | 'name' | 'id'>
): boolean {
  if (isPasswordType(control.tagName, control.type)) return true;
  if (hasProtectedAutocomplete(control.autoComplete)) return true;
  if (isOtpFieldName(control.name) || isOtpFieldName(control.id)) return true;
  return false;
}

export function formLooksLikeAuth(
  controls: ReadonlyArray<Pick<ControlSignals, 'tagName' | 'type' | 'autoComplete' | 'name' | 'id'>>
): boolean {
  return controls.some((control) => signalsLookLikeAuth(control));
}

/**
 * Password, hidden, captcha-token, and one-time-code fields, plus every control
 * in a form that asks for a password or a login code. Captcha tokens alone do
 * not disable the rest of a contact form.
 */
export function controlSignalsAreProtected(control: ControlSignals): boolean {
  if (control.hidden || control.inAuthForm) return true;
  if (isPasswordType(control.tagName, control.type)) return true;
  if (isHiddenInputType(control.tagName, control.type)) return true;
  if (hasProtectedAutocomplete(control.autoComplete)) return true;
  if (isCaptchaResponseName(control.name) || isCaptchaResponseName(control.id)) return true;
  if (isOtpFieldName(control.name) || isOtpFieldName(control.id)) return true;
  return false;
}

function readSignals(element: HTMLElement, inAuthForm: boolean): ControlSignals {
  const type = element instanceof HTMLInputElement ? element.type : '';
  return {
    tagName: element.tagName,
    type,
    hidden: element.hidden,
    autoComplete: element.getAttribute('autocomplete') ?? '',
    name: element.getAttribute('name') ?? '',
    id: element.id ?? '',
    inAuthForm,
  };
}

function associatedForm(element: HTMLElement): HTMLFormElement | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.form;
  }
  const form = element.closest('form');
  return form instanceof HTMLFormElement ? form : null;
}

function formControlSignals(form: HTMLFormElement): ControlSignals[] {
  const signals: ControlSignals[] = [];
  form.querySelectorAll('input, textarea').forEach((node) => {
    if (node instanceof HTMLElement) signals.push(readSignals(node, false));
  });
  return signals;
}

/** DOM adapter for `controlSignalsAreProtected`. Does not modify the element. */
export function elementIsProtected(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const form = associatedForm(element);
  const inAuthForm = form ? formLooksLikeAuth(formControlSignals(form)) : false;
  return controlSignalsAreProtected(readSignals(element, inAuthForm));
}

export interface TextInputProbe {
  signals: ControlSignals;
  width: number;
  height: number;
}

export interface EditorSnapshot {
  bodyEditable: boolean;
  hasContentEditable: boolean;
  textareas: ControlSignals[];
  textInputs: TextInputProbe[];
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email']);

export const EDITOR_INPUT_MIN_WIDTH = 160;
export const EDITOR_INPUT_MIN_HEIGHT = 24;

export function isTextLikeInputType(type: string): boolean {
  return TEXT_INPUT_TYPES.has(type.toLowerCase());
}

/** A cross-origin frame is worth running in only when it is itself an editor. */
export function snapshotLooksLikeEditor(snapshot: EditorSnapshot): boolean {
  if (snapshot.bodyEditable || snapshot.hasContentEditable) return true;
  if (snapshot.textareas.some((field) => !controlSignalsAreProtected(field))) return true;
  return snapshot.textInputs.some((field) => {
    if (controlSignalsAreProtected(field.signals)) return false;
    if (!isTextLikeInputType(field.signals.type)) return false;
    return field.width >= EDITOR_INPUT_MIN_WIDTH && field.height >= EDITOR_INPUT_MIN_HEIGHT;
  });
}

function elementIsContentEditable(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  const value = element.getAttribute('contenteditable');
  if (value == null) return false;
  const normalized = value.toLowerCase();
  return normalized === '' || normalized === 'true' || normalized === 'plaintext-only';
}

export function documentLooksLikeEditor(doc: Document): boolean {
  const body = doc.body;
  let hasContentEditable = Boolean(body && elementIsContentEditable(body));
  if (!hasContentEditable) {
    const nodes = doc.querySelectorAll('[contenteditable]');
    for (const node of nodes) {
      if (node instanceof HTMLElement && elementIsContentEditable(node)) {
        hasContentEditable = true;
        break;
      }
    }
  }

  const textareas: ControlSignals[] = [];
  doc.querySelectorAll('textarea').forEach((node) => {
    if (node instanceof HTMLTextAreaElement) {
      const form = node.form;
      const inAuthForm = form ? formLooksLikeAuth(formControlSignals(form)) : false;
      textareas.push(readSignals(node, inAuthForm));
    }
  });

  const textInputs: TextInputProbe[] = [];
  doc.querySelectorAll('input').forEach((node) => {
    if (!(node instanceof HTMLInputElement) || !isTextLikeInputType(node.type)) return;
    const form = node.form;
    const inAuthForm = form ? formLooksLikeAuth(formControlSignals(form)) : false;
    const rect = node.getBoundingClientRect();
    textInputs.push({
      signals: readSignals(node, inAuthForm),
      width: rect.width,
      height: rect.height,
    });
  });

  return snapshotLooksLikeEditor({
    bodyEditable: Boolean(body?.isContentEditable),
    hasContentEditable,
    textareas,
    textInputs,
  });
}

export interface FrameDecision {
  href: string;
  topFrame: boolean;
  sameOriginAncestors: boolean;
  editorDocument: boolean;
}

/**
 * Top documents and same-origin iframes keep working, including editors that
 * mount after the script starts. Cross-origin frames run only when the
 * document is an editor. Captcha and payment URLs never run.
 */
export function shouldRunContentScript(frame: FrameDecision): boolean {
  if (isBlockedFrameUrl(frame.href)) return false;
  if (frame.topFrame || frame.sameOriginAncestors) return true;
  return frame.editorDocument;
}

export function ancestorsShareOrigin(win: Window): boolean {
  try {
    let current = win;
    while (current !== current.parent) {
      void current.parent.location.href;
      current = current.parent;
    }
    return true;
  } catch {
    return false;
  }
}

export function readFrameDecision(win: Window, doc: Document): FrameDecision {
  const topFrame = win.top === win;
  const sameOriginAncestors = topFrame || ancestorsShareOrigin(win);
  return {
    href: win.location.href,
    topFrame,
    sameOriginAncestors,
    editorDocument: topFrame || sameOriginAncestors ? false : documentLooksLikeEditor(doc),
  };
}

/** Fail closed: a guard error must leave the frame untouched. */
export function contentScriptShouldStart(win: Window, doc: Document): boolean {
  try {
    return shouldRunContentScript(readFrameDecision(win, doc));
  } catch (error) {
    console.error('[SafeTyper] Leaving this frame untouched:', error);
    return false;
  }
}
