/**
 * Chrome Web Store screenshot generator for SafeTyper.
 *
 * Builds nothing. From the repo root, after `bun install` and `bun run build`:
 *
 *   cd scripts/store-assets && npm install
 *   node generate.mjs
 *
 * Uses the unpacked extension in `.output/chrome-mv3`, a local
 * OpenAI-compatible stub (Ollama chat-completions), and headed Chrome.
 * Marketing frames are written to /opt/cursor/artifacts.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const EXTENSION = path.join(REPO, '.output/chrome-mv3');
const ICON = path.join(REPO, 'public/icon/128.png');
const OUT = process.env.STORE_OUT || '/opt/cursor/artifacts';
const WORK = path.join(tmpdir(), 'safetyper-store');
const RAW = path.join(WORK, 'raw');

const ISSUES = [
  {
    quote: 'should definately',
    replacement: 'should definitely',
    group: 'correctness',
    subcategory: 'spelling',
    explanation: 'The standard spelling is definitely.',
  },
  {
    quote: 'a little wordy',
    replacement: 'wordy',
    group: 'clarity',
    subcategory: 'conciseness',
    explanation: 'Shorter, and the meaning stays.',
  },
  {
    quote: 'I want to make sure',
    replacement: "Let's make sure",
    group: 'engagement',
    subcategory: 'word-choice',
    explanation: 'Sounds more like a note to a teammate.',
  },
  {
    quote: 'Looking forward to your thoughts.',
    replacement: "I'd value your thoughts.",
    group: 'delivery',
    subcategory: 'tone',
    explanation: 'A warmer close fits a colleague.',
  },
  {
    quote: 'confussing',
    replacement: 'confusing',
    group: 'correctness',
    subcategory: 'spelling',
    explanation: 'The standard spelling is confusing.',
  },
  {
    quote: 'kind of buried',
    replacement: 'hard to find',
    group: 'engagement',
    subcategory: 'word-choice',
    explanation: 'A concrete phrase is easier to picture.',
  },
  {
    quote: 'a little hard to scan',
    replacement: 'hard to scan',
    group: 'clarity',
    subcategory: 'conciseness',
    explanation: 'Dropping “a little” makes the point faster to read.',
  },
  {
    quote: 'I think we should',
    replacement: 'We should',
    group: 'delivery',
    subcategory: 'confidence',
    explanation: 'Dropping the hedge makes the recommendation clearer.',
  },
  {
    quote: 'a real improvement',
    replacement: 'a sharp improvement',
    group: 'engagement',
    subcategory: 'vividness',
    explanation: 'A sharper word makes the gain easier to picture.',
  },
  {
    quote: 'suprising',
    replacement: 'surprising',
    group: 'correctness',
    subcategory: 'spelling',
    explanation: 'The standard spelling is surprising.',
  },
  {
    quote: 'a bit smaller',
    replacement: 'smaller',
    group: 'clarity',
    subcategory: 'conciseness',
    explanation: '“Smaller” already says how the icon should change.',
  },
];

const EMAIL = {
  greeting: 'Hi Maya,',
  body: 'Thanks for sending the draft over yesterday. The opening is strong, but the second paragraph is a little wordy and we should definately tighten the ask before Friday.',
  ask: 'I want to make sure the design team has the latest timeline.',
  close: 'Looking forward to your thoughts.',
  sign: 'Sam',
};

const POST =
  'A few people said the empty state was confussing. The invite step was kind of buried, and the helper text was a little hard to scan. I think we should also say that drafts stay on your device.';

const EDITOR_P1 =
  'The beta went out on Monday to twelve design teams. Most teams finished setup without help, which is a real improvement on the last round.';
const EDITOR_P2 =
  'One note was suprising. Several teams asked for a quieter icon, and they wanted it a bit smaller. I think we should ship both before Friday.';

const TRANSLATE_SENTENCE = 'Could we move the design review to Thursday afternoon?';
const TRANSLATE_REST = 'I can send the notes beforehand so you can skim them on the train.';
const TRANSLATE_ES = '¿Podemos pasar la revisión de diseño al jueves por la tarde?';

const FRAMES = [
  {
    file: 'store-1-suggestions.png',
    raw: 'suggestions.png',
    title: 'Grammarly-style fixes, <em>your own AI</em>',
    sub: 'Colored underlines and suggestion cards, in any box you type in.',
    address: 'harbor.mail/compose',
    wide: true,
  },
  {
    file: 'store-2-check-as-you-type.png',
    raw: 'typing.png',
    title: 'Checks <em>as you type</em>',
    sub: 'Underlines show up after a short pause, with a count on the icon.',
    address: 'harbor.mail/post',
    wide: true,
  },
  {
    file: 'store-3-editor.png',
    raw: 'editor.png',
    title: 'Full-page <em>editor</em>',
    sub: 'Suggestion cards on a longer document, grouped by what you want to improve.',
    address: 'SafeTyper editor',
    wide: true,
  },
  {
    file: 'store-4-translate.png',
    raw: 'translate.png',
    title: 'Translate <em>anything</em>',
    sub: 'Detect the language, then translate with the model you chose.',
    address: 'SafeTyper',
    wide: true,
  },
  {
    file: 'store-5-privacy.png',
    raw: 'settings.png',
    title: 'You own <em>your data</em>',
    sub: 'Your API key or local Ollama. Nothing stored on our servers.',
    address: 'SafeTyper settings',
    wide: false,
  },
];

function issuesFor(text) {
  return ISSUES.filter((issue) => text.includes(issue.quote));
}

function userText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const user = [...list].reverse().find((message) => message?.role === 'user');
  return typeof user?.content === 'string' ? user.content : '';
}

function systemText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((message) => message?.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n');
}

function translationOf(user) {
  const marker = 'Text:\n';
  const at = user.lastIndexOf(marker);
  const text = (at === -1 ? user : user.slice(at + marker.length)).trim();
  if (text === TRANSLATE_SENTENCE || text.includes(TRANSLATE_SENTENCE)) {
    const translation = text === TRANSLATE_SENTENCE
      ? TRANSLATE_ES
      : `${TRANSLATE_ES} Puedo enviar las notas antes para que las revises en el tren.`;
    return {
      translation,
      detectedSourceLanguage: 'English',
      alternatives: [],
    };
  }
  return {
    translation: text,
    detectedSourceLanguage: 'English',
    alternatives: [],
  };
}

function replyFor(body) {
  const system = systemText(body.messages);
  const user = userText(body.messages);
  if (system.includes('translation engine')) {
    return JSON.stringify(translationOf(user));
  }
  const passage = user.includes('Text:') ? user.slice(user.lastIndexOf('Text:')) : user;
  const issues = issuesFor(passage);
  return JSON.stringify({ issues });
}

function startServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' || !['/compose', '/post', '/thread', '/api/tags'].includes(url.pathname)) {
      if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        console.log(`[stub] ${req.method} ${url.pathname}`);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama3.2', model: 'llama3.2' }] }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/compose') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(composePage());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/post') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(postPage());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/thread') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(threadPage());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }
        const content = replyFor(body);
        const preview = userText(body.messages).replace(/\s+/g, ' ').slice(0, 180);
        requests.push(preview);
        console.log(`[stub] ${requests.length} ${preview}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

const PAGE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: Inter, "Segoe UI", sans-serif;
    color: #1c1917;
    background: #e7ece6;
    -webkit-font-smoothing: antialiased;
  }
  button, textarea, [contenteditable="true"] { font-family: inherit; }
`;

function composePage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Compose</title>
<style>${PAGE_CSS}
  body { display: flex; flex-direction: column; }
  header {
    height: 56px; display: flex; align-items: center; gap: 18px;
    padding: 0 28px; background: #f7f8f6; border-bottom: 1px solid #dde3da;
  }
  .mark { width: 22px; height: 22px; border-radius: 7px; background: #0b2e1a; }
  .brand { font-weight: 650; letter-spacing: -0.03em; }
  nav { display: flex; gap: 16px; color: #78716c; font-size: 14px; margin-left: 12px; }
  nav .on { color: #1c1917; font-weight: 600; }
  main { flex: 1; display: flex; padding: 28px 32px 32px; }
  .card {
    width: 500px; background: #fff; border-radius: 16px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 12px 32px rgb(0 0 0 / 0.06);
    display: flex; flex-direction: column; min-height: 0;
  }
  .row { display: flex; gap: 12px; align-items: center; padding: 14px 22px; border-bottom: 1px solid #f0f1ee; font-size: 14px; }
  .row span { width: 64px; color: #a8a29e; }
  .subject { font-weight: 650; letter-spacing: -0.02em; }
  #compose {
    flex: 1; margin: 8px 10px 12px; padding: 16px 18px 36px;
    border-radius: 12px; outline: none; font-size: 16px; line-height: 1.65;
    min-height: 360px;
  }
  #compose p { margin: 0 0 14px; }
</style></head>
<body>
  <header>
    <div class="mark"></div>
    <div class="brand">Harbor</div>
    <nav><span class="on">Drafts</span><span>Inbox</span><span>Sent</span></nav>
  </header>
  <main>
    <section class="card">
      <div class="row"><span>To</span><strong>Maya Chen</strong></div>
      <div class="row"><span>Subject</span><div class="subject">Friday draft for the design team</div></div>
      <div id="compose" contenteditable="true" spellcheck="false" role="textbox" aria-label="Message">
        <p>${EMAIL.greeting}</p>
        <p>${EMAIL.body}</p>
        <p>${EMAIL.ask}</p>
        <p>${EMAIL.close}</p>
        <p>${EMAIL.sign}</p>
      </div>
    </section>
  </main>
</body></html>`;
}

function postPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>New post</title>
<style>${PAGE_CSS}
  body { display: grid; place-items: center; }
  .card {
    width: 720px; background: #fff; border-radius: 18px; padding: 22px 22px 18px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 16px 40px rgb(0 0 0 / 0.07);
  }
  .who { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
  .avatar {
    width: 42px; height: 42px; border-radius: 50%; background: #0b2e1a; color: #fff;
    display: grid; place-items: center; font-weight: 650; letter-spacing: -0.03em;
  }
  .who strong { display: block; font-size: 15px; letter-spacing: -0.02em; }
  .who span { color: #78716c; font-size: 13px; }
  textarea {
    width: 100%; min-height: 220px; resize: none; border: 0; outline: none;
    font-size: 18px; line-height: 1.6; color: #1c1917; background: transparent;
    padding: 8px 8px 36px;
  }
  .bar { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid #f0f1ee; }
  .hint { color: #a8a29e; font-size: 13px; }
  .post {
    height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: #0b2e1a;
    color: #fff; font-weight: 650; font-size: 14px;
  }
</style></head>
<body>
  <article class="card">
    <div class="who">
      <div class="avatar">S</div>
      <div><strong>Sam Ortiz</strong><span>Product, Harbor</span></div>
    </div>
    <textarea id="post" spellcheck="true" aria-label="Post">${POST}</textarea>
    <div class="bar"><span class="hint">Share an update with the team</span><button class="post" type="button">Post</button></div>
  </article>
</body></html>`;
}

function threadPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Thread</title>
<style>${PAGE_CSS}
  body { display: grid; place-items: start center; padding-top: 48px; }
  .card {
    width: 680px; background: #fff; border-radius: 18px; padding: 28px 32px 36px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 16px 40px rgb(0 0 0 / 0.07);
  }
  .kicker { color: #78716c; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  h1 { margin: 8px 0 18px; font-size: 28px; letter-spacing: -0.04em; font-weight: 680; }
  .who { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%; background: #14532d; color: #fff;
    display: grid; place-items: center; font-weight: 650;
  }
  .who strong { display: block; font-size: 15px; }
  .who span { color: #a8a29e; font-size: 13px; }
  p { margin: 0 0 14px; font-size: 18px; line-height: 1.6; }
  #quote { background: transparent; }
</style></head>
<body>
  <article class="card">
    <div class="kicker">Message</div>
    <h1>Design review this week</h1>
    <div class="who">
      <div class="avatar">P</div>
      <div><strong>Priya Nair</strong><span>To Luca · Today, 9:14 AM</span></div>
    </div>
    <p>Hi Luca,</p>
    <p><span id="quote">${TRANSLATE_SENTENCE}</span> ${TRANSLATE_REST}</p>
    <p>Priya</p>
  </article>
</body></html>`;
}

function ensureDisplay() {
  if (process.env.DISPLAY) return null;
  const child = spawn('Xvfb', [':99', '-screen', '0', '1600x1000x24', '-ac', '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  process.env.DISPLAY = ':99';
  execFileSync('sleep', ['0.4']);
  return child;
}

async function launchBrowser() {
  const userData = path.join(WORK, `profile-${Date.now()}`);
  mkdirSync(userData, { recursive: true });
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=DisableLoadExtensionCommandLineSwitch,Translate,TranslateUI,SpellCheck',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--window-position=40,20',
      '--window-size=1320,900',
    ],
  });
  const deadline = Date.now() + 20000;
  let worker;
  while (Date.now() < deadline) {
    const workers = context.serviceWorkers();
    if (workers.length) console.log('[workers]', workers.map((item) => item.url()).join(' | '));
    worker = workers.find((item) => item.url().includes('/background.js'));
    if (worker) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!worker) throw new Error('SafeTyper service worker did not start');
  const id = new URL(worker.url()).host;
  console.log(`[ext] ${id}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const page of context.pages().slice(1)) {
    await page.close().catch(() => {});
  }
  return { context, worker, id };
}

async function configure(context, extensionId, endpoint, extra = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    async ({ endpoint, extra }) => {
      const api = globalThis.chrome?.storage?.local ? globalThis.chrome : globalThis.browser;
      await api.storage.local.set({
        selectedProvider: 'ollama',
        ollamaEndpoint: endpoint,
        ollamaSelectedModel: 'llama3.2',
        hasCompletedOnboarding: true,
        autoCheckEnabled: false,
        iconSize: 'medium',
        darkMode: false,
        popupTab: 'settings',
        translateTargetLanguage: 'es',
        translateSourceLanguage: 'auto',
        writingGoals: {
          audience: 'knowledgeable',
          formality: 'neutral',
          domain: 'email',
          intent: 'inform',
        },
        ...extra,
      });
    },
    { endpoint, extra }
  );
  await page.close();
}

function watch(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[page] ${msg.text()}`);
  });
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
}

async function blurPopup(page) {
  await page.evaluate(() => {
    const host = document.querySelector('.safetyper-popup-host');
    const active = host?.shadowRoot?.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.mouse.move(12, 12);
}

async function captureSuggestions(page, origin) {
  await page.setViewportSize({ width: 1040, height: 860 });
  await page.goto(`${origin}/compose`, { waitUntil: 'domcontentloaded' });
  const field = page.locator('#compose');
  await field.click();
  await page.locator('.safetyper-icon').waitFor({ timeout: 10000 });
  await page.locator('.safetyper-icon').click();
  await page.locator('.st-check').click();
  try {
    await page.locator('.st-card').nth(3).waitFor({ timeout: 20000 });
  } catch (error) {
    const popupText = await page.evaluate(() => {
      const host = document.querySelector('.safetyper-popup-host');
      const content = host?.shadowRoot?.querySelector('.safetyper-popup-content');
      return content?.textContent?.replace(/\s+/g, ' ').slice(0, 500) || 'no popup';
    });
    await page.screenshot({ path: path.join(RAW, 'debug-suggestions.png') });
    console.log('[debug popup]', popupText);
    throw error;
  }
  await page.waitForTimeout(400);
  await blurPopup(page);
  await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(RAW, 'suggestions.png'), animations: 'disabled' });
    cropToContent(path.join(RAW, 'suggestions.png'));
  const box = await page.locator('.safetyper-popup-host').boundingBox();
  console.log('[shot] suggestions popup', box);
}

async function captureTyping(page, origin) {
  await page.setViewportSize({ width: 980, height: 620 });
  await page.goto(`${origin}/post`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const field = page.locator('#post');
  await field.click();
  try {
    await page.locator('.safetyper-icon').waitFor({ timeout: 2500 });
  } catch {
    await field.click();
    await page.locator('.safetyper-icon').waitFor({ timeout: 8000 });
  }
  await page.waitForTimeout(400);
  await field.fill('');
  await field.fill(POST);
  await field.dispatchEvent('input');
  try {
    await page.locator('.safetyper-badge.is-visible').waitFor({ timeout: 20000 });
    await page.locator('.safetyper-underline-bar').nth(3).waitFor({ timeout: 20000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      badge: document.querySelector('.safetyper-badge')?.textContent || '',
      bars: document.querySelectorAll('.safetyper-underline-bar').length,
      icon: !!document.querySelector('.safetyper-icon'),
    }));
    await page.screenshot({ path: path.join(RAW, 'debug-typing.png') });
    console.log('[debug typing]', state);
    throw error;
  }
  await page.waitForTimeout(500);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: path.join(RAW, 'typing.png'), animations: 'disabled' });
  cropToContent(path.join(RAW, 'typing.png'));
  const badge = await page.locator('.safetyper-badge').innerText();
  console.log('[shot] typing badge', badge);
}

async function captureEditor(page, extensionId) {
  await page.setViewportSize({ width: 1180, height: 780 });
  await page.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByLabel('Title').fill('Note to design partners');
  const prose = page.locator('.ProseMirror');
  await prose.click();
  await page.keyboard.insertText(EDITOR_P1);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(EDITOR_P2);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.locator('.safetyper-issue').nth(3).waitFor({ timeout: 20000 });
  const banner = page.locator('.banner');
  const bannerText = (await banner.innerText().catch(() => '')).replace(/\s+/g, ' ');
  console.log('[shot] editor banner', bannerText);
  if (/error|not JSON|refused|Could not/i.test(bannerText)) {
    throw new Error(`Editor check failed: ${bannerText}`);
  }
  await page.locator('.safetyper-issue', { hasText: 'suprising' }).click();
  await page.locator('.suggestion-card').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.mouse.move(16, 16);
  await page.screenshot({ path: path.join(RAW, 'editor.png'), animations: 'disabled' });
  cropToContent(path.join(RAW, 'editor.png'));
}

async function selectSentence(page) {
  await page.evaluate((sentence) => {
    const node = document.getElementById('quote');
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (selection?.toString().trim() !== sentence) {
      throw new Error(`Selection was "${selection?.toString()}"`);
    }
  }, TRANSLATE_SENTENCE);
}

async function showTranslateBubble(page) {
  await selectSentence(page);
  await page.bringToFront();
  const names = execFileSync('xdotool', ['search', '--onlyvisible', '--name', '.'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  console.log('[windows]', names.length);
  for (const id of names) {
    const title = execFileSync('xdotool', ['getwindowname', id], { encoding: 'utf8' }).trim();
    if (/Thread|Chromium|Chrome/i.test(title)) {
      execFileSync('xdotool', ['windowactivate', '--sync', id]);
      console.log('[focus]', title);
      break;
    }
  }
  execFileSync('xdotool', ['key', '--clearmodifiers', 'alt+shift+t']);
  await page.locator('.tr-body').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-safetyper-translate]');
    const text = host?.shadowRoot?.querySelector('.tr-body')?.textContent || '';
    return text.includes('¿') || text.includes('revisión');
  }, { timeout: 12000 });
}

async function captureTranslatePopup(page, extensionId) {
  await page.setViewportSize({ width: 440, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const commands = await page.evaluate(() => chrome.commands.getAll());
  console.log('[commands]', JSON.stringify(commands));
  await page.getByRole('tab', { name: 'Translate' }).click();
  await page.locator('#target-language').selectOption('es');
  await page.locator('#translate-input').fill(TRANSLATE_SENTENCE);
  await page.locator('#translate-button').click();
  await page.locator('.output-text').waitFor({ timeout: 15000 });
  const output = await page.locator('.output-text').innerText();
  if (!output.includes('¿')) throw new Error(`Unexpected translation: ${output}`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(RAW, 'translate.png'), animations: 'disabled' });
  cropToContent(path.join(RAW, 'translate.png'));
  console.log('[shot] translate tab', output);
}

async function captureTranslate(page, origin, extensionId) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto(`${origin}/thread`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  try {
    await showTranslateBubble(page);
    await page.waitForTimeout(250);
    await page.mouse.move(12, 12);
    await page.screenshot({ path: path.join(RAW, 'translate.png'), animations: 'disabled' });
    cropToContent(path.join(RAW, 'translate.png'));
    console.log('[shot] translate bubble ready');
  } catch (error) {
    console.log('[shot] bubble unavailable', error instanceof Error ? error.message : error);
    await page.screenshot({ path: path.join(RAW, 'debug-translate.png') }).catch(() => {});
    await captureTranslatePopup(page, extensionId);
  }
}

async function captureSettings(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const api = globalThis.chrome?.storage?.local ? globalThis.chrome : globalThis.browser;
    await api.storage.local.set({
      selectedProvider: 'ollama',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaSelectedModel: 'llama3.2',
      popupTab: 'settings',
      autoCheckEnabled: true,
      iconSize: 'medium',
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 460, height: 920 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#provider-select').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => {
    const select = document.querySelector('#provider-select');
    return select instanceof HTMLSelectElement && select.value === 'ollama';
  });
  const endpoint = page.locator('#endpoint-input');
  await endpoint.waitFor();
  if ((await endpoint.inputValue()) !== 'http://localhost:11434') {
    throw new Error(`Unexpected endpoint: ${await endpoint.inputValue()}`);
  }
  await page.evaluate(() => {
    const select = document.querySelector('#provider-select');
    if (select instanceof HTMLSelectElement) {
      select.size = 3;
      select.style.setProperty('height', '96px', 'important');
      select.style.setProperty('min-height', '96px', 'important');
      select.style.setProperty('padding-top', '4px', 'important');
      select.style.setProperty('background-image', 'none', 'important');
    }
    const goals = document.querySelector('fieldset.goals');
    let sibling = goals?.nextElementSibling ?? null;
    while (sibling) {
      const next = sibling.nextElementSibling;
      sibling.remove();
      sibling = next;
    }
  });
  await page.waitForTimeout(200);
  await page.locator('#app').screenshot({
    path: path.join(RAW, 'settings-page.png'),
    animations: 'disabled',
  });
  try {
    execFileSync('scrot', ['-o', path.join(RAW, 'settings-screen.png')]);
  } catch (error) {
    console.log('[shot] scrot failed', error instanceof Error ? error.message : error);
  }
  execFileSync('cp', [path.join(RAW, 'settings-page.png'), path.join(RAW, 'settings.png')]);
  cropToContent(path.join(RAW, 'settings.png'));
  console.log('[shot] settings captured');
}

function cropToContent(file) {
  const script = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size
bg = im.getpixel((2, 2))
def differs(x, y):
    r, g, b = im.getpixel((x, y))
    return abs(r-bg[0]) + abs(g-bg[1]) + abs(b-bg[2]) > 18
minx, miny, maxx, maxy = w, h, 0, 0
for y in range(h):
    for x in range(w):
        if differs(x, y):
            if x < minx: minx = x
            if y < miny: miny = y
            if x > maxx: maxx = x
            if y > maxy: maxy = y
pad = 18
box = (max(0, minx-pad), max(0, miny-pad), min(w, maxx+1+pad), min(h, maxy+1+pad))
im.crop(box).save(${JSON.stringify(file)})
print(box, 'from', (w, h))
`;
  execFileSync('python3', ['-c', script], { stdio: 'inherit' });
}

function marqueeShot() {
  const source = path.join(RAW, 'suggestions.png');
  const dest = path.join(RAW, 'marquee-ui.png');
  const script = `
from PIL import Image
im = Image.open(${JSON.stringify(source)}).convert('RGB')
w, h = im.size
bottom = min(h, 548)
im.crop((0, 12, w, bottom)).save(${JSON.stringify(dest)})
`;
  execFileSync('python3', ['-c', script]);
  return dest;
}

function dataUri(file) {
  const bytes = readFileSync(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function prepareIcon() {
  const dest = path.join(RAW, 'mark.png');
  execFileSync('convert', [
    ICON,
    '-alpha', 'set',
    '-background', 'none',
    '-trim',
    '+repage',
    '-filter', 'point',
    '-resize', '160x160',
    dest,
  ]);
  return dest;
}

function frameHtml(frame, shot) {
  const wide = frame.wide;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body {
    font-family: Inter, "Segoe UI", sans-serif;
    color: #f4fff8;
    background:
      radial-gradient(820px 420px at 88% -8%, rgba(74, 222, 128, 0.20), transparent 62%),
      radial-gradient(640px 480px at -10% 110%, rgba(22, 101, 52, 0.55), transparent 60%),
      linear-gradient(165deg, #07140e 0%, #0b2e1a 46%, #06110c 100%);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { height: 100%; box-sizing: border-box; padding: 36px 44px 32px; display: flex; flex-direction: column; }
  h1 {
    margin: 0; font-size: 42px; line-height: 1.12; font-weight: 700; letter-spacing: -0.038em;
  }
  h1 em { font-style: normal; color: #86efac; }
  p.sub { margin: 10px 0 0; font-size: 20px; line-height: 1.35; color: #c9ddd1; font-weight: 450; }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; padding-top: 22px; }
  .browser {
    ${wide ? 'width: 1192px; height: 648px;' : 'width: 500px; height: 648px;'}
    background: #f4f4f2;
    border-radius: 16px;
    overflow: hidden;
    box-shadow:
      0 30px 70px rgba(0, 0, 0, 0.38),
      0 2px 0 rgba(255, 255, 255, 0.16) inset,
      0 0 0 1px rgba(255, 255, 255, 0.08);
    display: flex; flex-direction: column;
  }
  .chrome { height: 42px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #eceae6; }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; display: block; }
  .dots i:nth-child(1) { background: #ff5f57; }
  .dots i:nth-child(2) { background: #febc2e; }
  .dots i:nth-child(3) { background: #28c840; }
  .address {
    margin-left: 8px; flex: 1; height: 26px; border-radius: 8px; background: #fff;
    color: #44403c; font-size: 12px; display: flex; align-items: center; padding: 0 10px;
    letter-spacing: -0.01em;
  }
  .shot {
    flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
    background: #e7ece6; line-height: 0;
  }
  .shot img { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
</style></head>
<body>
  <div class="wrap">
    <h1>${frame.title}</h1>
    <p class="sub">${frame.sub}</p>
    <div class="stage">
      <div class="browser">
        <div class="chrome"><div class="dots"><i></i><i></i><i></i></div><div class="address">${frame.address}</div></div>
        <div class="shot"><img src="${shot}" alt=""></div>
      </div>
    </div>
  </div>
</body></html>`;
}

function promoSmallHtml(icon) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body {
    font-family: Inter, "Segoe UI", sans-serif;
    color: #f4fff8;
    background:
      radial-gradient(280px 180px at 100% 0%, rgba(74, 222, 128, 0.22), transparent 70%),
      #0b2e1a;
    -webkit-font-smoothing: antialiased;
  }
  .row { display: flex; gap: 16px; align-items: center; padding: 28px 26px 0; }
  .disc {
    width: 84px; height: 84px; flex: none; border-radius: 50%; background: #0b2e1a;
    box-shadow: inset 0 0 0 2px #1f6b3a, 0 8px 18px rgba(0,0,0,0.28);
    display: grid; place-items: center;
  }
  .disc img { width: 58px; height: 58px; image-rendering: pixelated; image-rendering: crisp-edges; }
  h1 { margin: 0; font-size: 34px; letter-spacing: -0.04em; font-weight: 730; }
  p { margin: 18px 26px 0; font-size: 20px; line-height: 1.28; font-weight: 560; letter-spacing: -0.02em; color: #e7f6ec; }
</style></head>
<body>
  <div class="row"><div class="disc"><img src="${icon}" alt=""></div><h1>SafeTyper</h1></div>
  <p>A Grammarly alternative where you own what you type</p>
</body></html>`;
}

function promoMarqueeHtml(icon, shot) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1400px; height: 560px; overflow: hidden; }
  body {
    font-family: Inter, "Segoe UI", sans-serif;
    color: #f4fff8;
    background:
      radial-gradient(700px 420px at 78% 120%, rgba(74, 222, 128, 0.16), transparent 60%),
      radial-gradient(520px 320px at 0% 0%, rgba(22, 101, 52, 0.45), transparent 70%),
      linear-gradient(100deg, #07150f 0%, #0b2e1a 48%, #082216 100%);
    -webkit-font-smoothing: antialiased;
  }
  .layout { height: 100%; display: grid; grid-template-columns: 640px 1fr; align-items: center; padding: 0 48px 0 56px; box-sizing: border-box; }
  .disc {
    width: 112px; height: 112px; border-radius: 50%; background: #0b2e1a;
    box-shadow: inset 0 0 0 3px #1f6b3a;
    display: grid; place-items: center; margin-bottom: 22px;
  }
  .disc img { width: 76px; height: 76px; image-rendering: pixelated; image-rendering: crisp-edges; }
  h1 { margin: 0; font-size: 68px; line-height: 0.95; letter-spacing: -0.045em; font-weight: 740; }
  p { margin: 18px 0 0; max-width: 520px; font-size: 28px; line-height: 1.25; font-weight: 520; letter-spacing: -0.025em; color: #e5f6eb; }
  .frame {
    justify-self: end; width: 640px; border-radius: 18px; overflow: hidden; background: #f4f4f2;
    box-shadow: 0 24px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
  }
  .chrome { height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 12px; background: #eceae6; }
  .chrome i { width: 9px; height: 9px; border-radius: 50%; display: block; background: #d6d3d1; }
  .chrome i:nth-child(1) { background: #ff5f57; }
  .chrome i:nth-child(2) { background: #febc2e; }
  .chrome i:nth-child(3) { background: #28c840; }
  .frame img { width: 100%; height: auto; display: block; }
</style></head>
<body>
  <div class="layout">
    <div>
      <div class="disc"><img src="${icon}" alt=""></div>
      <h1>SafeTyper</h1>
      <p>A Grammarly alternative where you own what you type</p>
    </div>
    <div class="frame">
      <div class="chrome"><i></i><i></i><i></i></div>
      <img src="${shot}" alt="">
    </div>
  </div>
</body></html>`;
}

function overviewHtml(items) {
  const cards = items
    .map(
      (item) => `<figure>
        <img src="${item.src}" alt="">
        <figcaption>${item.name}<br>${item.size}</figcaption>
      </figure>`
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #f6f7f4; }
  body { font-family: Inter, sans-serif; color: #1c1917; padding: 28px 32px 36px; width: 1680px; box-sizing: border-box; }
  h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: -0.03em; }
  .note { margin: 0 0 18px; color: #57534e; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; width: 390px; }
  figure.wide { width: 796px; }
  img { width: 100%; height: auto; display: block; border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.12); background: #fff; }
  figcaption { margin-top: 6px; font-size: 13px; line-height: 1.35; color: #44403c; }
</style></head>
<body>
  <h1>SafeTyper 2.6.0 store images</h1>
  <p class="note">Chrome Web Store screenshots and promo tiles.</p>
  <div class="grid">${cards}</div>
</body></html>`;
}

async function renderHtml(browser, html, width, height, dest) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: dest, animations: 'disabled' });
  await page.close();
}

function flatten(file) {
  const temp = `${file}.flat.png`;
  execFileSync('convert', [file, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', `PNG24:${temp}`]);
  execFileSync('mv', [temp, file]);
}

function identify(file) {
  return execFileSync('identify', ['-format', '%f %wx%h channels=%[channels] alpha=%A\\n', file], {
    encoding: 'utf8',
  }).trim();
}

async function compose(browser) {
  const icon = dataUri(prepareIcon());
  for (const frame of FRAMES) {
    const shot = dataUri(path.join(RAW, frame.raw));
    const dest = path.join(OUT, frame.file);
    await renderHtml(browser, frameHtml(frame, shot), 1280, 800, dest);
    flatten(dest);
    console.log(identify(dest));
  }
  const small = path.join(OUT, 'promo-small-440x280.png');
  await renderHtml(browser, promoSmallHtml(icon), 440, 280, small);
  flatten(small);
  console.log(identify(small));

  const marquee = path.join(OUT, 'promo-marquee-1400x560.png');
  await renderHtml(
    browser,
    promoMarqueeHtml(icon, dataUri(marqueeShot())),
    1400,
    560,
    marquee
  );
  flatten(marquee);
  console.log(identify(marquee));

  const overview = path.join(OUT, 'store-overview.png');
  const items = [
    ...FRAMES.map((frame) => ({
      name: frame.file,
      size: '1280×800',
      src: dataUri(path.join(OUT, frame.file)),
    })),
    { name: 'promo-small-440x280.png', size: '440×280', src: dataUri(small) },
    { name: 'promo-marquee-1400x560.png', size: '1400×560', src: dataUri(marquee), wide: true },
  ];
  const overviewPage = await browser.newPage({ viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 1 });
  await overviewPage.setContent(overviewHtml(items).replace('figure.wide { width: 796px; }', 'figure.wide { width: 796px; }'), {
    waitUntil: 'load',
  });
  const height = await overviewPage.evaluate(() => document.body.scrollHeight);
  await overviewPage.setViewportSize({ width: 1680, height });
  await overviewPage.screenshot({ path: overview, animations: 'disabled', fullPage: true });
  await overviewPage.close();
  flatten(overview);
  console.log(identify(overview));
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  ensureDisplay();
  const { server, port } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  console.log(`[stub] ${origin}`);
  const { context, worker, id } = await launchBrowser();
  try {
    await configure(context, id, origin);
    const page = context.pages()[0] || (await context.newPage());
    watch(page);
    await captureSuggestions(page, origin);
    await configure(context, id, origin, { autoCheckEnabled: true });
    await captureTyping(page, origin);
    await captureEditor(page, id);
    await captureTranslate(page, origin, id);
    await captureSettings(page, id);
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await compose(browser);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
