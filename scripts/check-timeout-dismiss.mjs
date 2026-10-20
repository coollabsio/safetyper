/**
 * Timeout, clean-reply, dismiss, and card-anchor checks against a local stub.
 *
 *   CHROME=/opt/google/chrome/chrome node scripts/check-timeout-dismiss.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, '.output/chrome-mv3');
const pageDir = path.join(root, 'src/entrypoints/test');
const shots = process.env.SUGGESTION_SHOTS || '/opt/cursor/artifacts';
const chrome = [
  process.env.CHROME,
  '/tmp/chrome-cache/chrome/linux-131.0.6778.264/chrome-linux64/chrome',
  '/opt/google/chrome/chrome',
  '/usr/local/bin/chrome',
].find((candidate) => candidate && fs.existsSync(candidate));
if (!chrome) throw new Error('Set CHROME to a Chromium build that still accepts --load-extension');

const pagePort = 8814;
const stubPort = 8815;
let mode = 'reply';

function userText(payload) {
  return (payload.messages || [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content || '')
    .join('\n');
}

function replyFor(user) {
  if (/\bi are baboon\b/.test(user)) {
    return JSON.stringify({
      issues: [
        {
          quote: 'i are baboon',
          replacement: 'I am a baboon',
          category: 'grammar',
          explanation: 'The verb does not agree with the subject.',
        },
      ],
    });
  }
  if (/\bi am baboon\b/.test(user)) {
    return JSON.stringify({
      issues: [
        {
          quote: 'i am baboon',
          replacement: 'I am a baboon',
          category: 'grammar',
          explanation: 'Add the article.',
        },
      ],
    });
  }
  if (/\bhello\b/i.test(user)) return 'No issues found.';
  return '{"issues":[]}';
}

const stub = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mode') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      mode = Buffer.concat(chunks).toString('utf8').trim() || 'reply';
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(mode);
    });
    return;
  }
  if (req.method === 'GET' && (req.url || '').startsWith('/api/tags')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'stub' }] }));
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (mode === 'hang') return;
    const send = () => {
      let content = '{"issues":[]}';
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        content = replyFor(userText(payload));
      } catch (error) {
        content = String(error);
      }
      const native = (req.url || '').includes('/api/chat');
      const body = native
        ? { message: { role: 'assistant', content } }
        : { choices: [{ message: { content } }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (mode === 'slow') setTimeout(send, 2500);
    else send();
  });
});

await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));
const pageServer = spawn('python3', ['-m', 'http.server', String(pagePort), '--bind', '127.0.0.1'], {
  cwd: pageDir,
  stdio: 'ignore',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function setMode(next) {
  mode = next;
  await fetch(`http://127.0.0.1:${stubPort}/mode`, { method: 'POST', body: next });
}

const defaultDisabled =
  '--disable-features=AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate';

fs.mkdirSync(shots, { recursive: true });

const context = await chromium.launchPersistentContext(`/tmp/pw-timeout-dismiss-${Date.now()}`, {
  headless: false,
  executablePath: chrome,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  ignoreDefaultArgs: ['--disable-extensions', defaultDisabled],
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    `${defaultDisabled},DisableLoadExtensionCommandLineSwitch`,
    '--no-first-run',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const endpoint = `http://127.0.0.1:${stubPort}`;
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({
      selectedProvider: 'ollama',
      ollamaEndpoint: value,
      ollamaSelectedModel: 'stub',
      darkMode: false,
      hasCompletedOnboarding: true,
      customSystemPrompt: '',
      personalDictionary: [],
      disabledGroups: [],
      autoCheckEnabled: true,
      autoCheckDisabledHosts: [],
      translateTargetLanguage: 'hu',
      popupTab: 'settings',
    });
  }, endpoint);

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${pagePort}/index.html`, { waitUntil: 'domcontentloaded' });
  const field = page.locator('#suggestion-sample');
  await field.scrollIntoViewIfNeeded();
  await field.fill('i are baboon today');
  await field.click();
  await page.locator('.safetyper-icon').waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const badge = page.locator('body > .safetyper-icon .safetyper-badge.is-visible');
  await badge.waitFor({ timeout: 12000 });
  const bar = page.locator('.safetyper-underline-bar').first();
  await bar.waitFor({ timeout: 8000 });
  assert((await badge.innerText()) === '1', `expected one suggestion, badge was ${await badge.innerText()}`);

  await bar.click();
  const host = page.locator('.safetyper-popup-host');
  await host.locator('.st-card').first().waitFor({ timeout: 8000 });
  const barBox = await bar.boundingBox();
  const cardBox = await host.boundingBox();
  assert(barBox && cardBox, 'underline and card are visible');
  const under =
    cardBox.y >= barBox.y + barBox.height - 8 &&
    cardBox.x < barBox.x + barBox.width + 24 &&
    cardBox.x + cardBox.width > barBox.x - 24;
  const above =
    cardBox.y + cardBox.height <= barBox.y + 12 &&
    cardBox.x < barBox.x + barBox.width + 24 &&
    cardBox.x + cardBox.width > barBox.x - 24;
  assert(under || above, `card is not anchored to the quote: bar ${JSON.stringify(barBox)} card ${JSON.stringify(cardBox)}`);

  const before = {
    x: Math.max(0, Math.min(barBox.x, cardBox.x) - 24),
    y: Math.max(0, Math.min(barBox.y, cardBox.y) - 48),
  };
  before.width = Math.min(1280 - before.x, Math.max(barBox.x + barBox.width, cardBox.x + cardBox.width) + 48 - before.x);
  before.height = Math.min(900 - before.y, Math.max(barBox.y + barBox.height, cardBox.y + cardBox.height) + 32 - before.y);
  await page.screenshot({ path: path.join(shots, 'card-under-text-before-dismiss.png'), clip: before });

  await host.locator('button', { hasText: 'Dismiss' }).click();
  await host.locator('.st-done').waitFor({ timeout: 4000 });
  assert((await page.locator('.safetyper-underline-bar').count()) === 0, 'dismiss leaves an underline');
  assert((await page.locator('body > .safetyper-icon .safetyper-badge.is-visible').count()) === 0, 'dismiss leaves the badge');
  const afterCard = await host.boundingBox();
  const fieldBox = await field.boundingBox();
  assert(afterCard && fieldBox, 'card and field stay visible after dismiss');
  const after = {
    x: Math.max(0, Math.min(fieldBox.x, afterCard.x) - 24),
    y: Math.max(0, Math.min(fieldBox.y, afterCard.y) - 48),
  };
  after.width = Math.min(
    1280 - after.x,
    Math.max(fieldBox.x + fieldBox.width, afterCard.x + afterCard.width) + 48 - after.x
  );
  after.height = Math.min(
    900 - after.y,
    Math.max(fieldBox.y + fieldBox.height, afterCard.y + afterCard.height) + 32 - after.y
  );
  await page.screenshot({ path: path.join(shots, 'card-after-dismiss.png'), clip: after });

  await page.keyboard.press('Escape');
  await field.click();
  await field.press('Home');
  await page.keyboard.type(' ');
  await page.waitForTimeout(4000);
  assert(
    (await page.locator('body > .safetyper-icon .safetyper-badge.is-visible').count()) === 0,
    'a space elsewhere brought the dismissed suggestion back'
  );
  assert(
    (await page.locator('.safetyper-underline-bar').count()) === 0,
    'a space elsewhere restored the underline'
  );

  await field.fill('i am baboon today');
  await field.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await badge.waitFor({ timeout: 12000 });
  assert((await badge.innerText()) === '1', 'editing the flagged text should show the new suggestion');

  await page.keyboard.press('Escape');
  await field.fill('hello');
  await field.click();
  await page.locator('.safetyper-icon').click();
  await page.locator('.st-check').click();
  await host.locator('.st-done', { hasText: 'Looks good' }).waitFor({ timeout: 8000 });
  await host.screenshot({ path: path.join(shots, 'card-looks-good-hello.png') });
  await page.keyboard.press('Escape');

  await setMode('slow');
  await field.fill('Please check this slow sentence today.');
  await field.click();
  await page.locator('.safetyper-icon').click();
  const slowStart = Date.now();
  await page.locator('.st-check').click();
  await host.locator('.st-done', { hasText: 'Looks good' }).waitFor({ timeout: 8000 });
  assert(Date.now() - slowStart >= 2000, 'a slow stub should not resolve before the model replies');
  await page.keyboard.press('Escape');

  await worker.evaluate(() => {
    globalThis.__SAFETYPER_TIMEOUT_MS = 1200;
  });
  await setMode('hang');
  await field.fill('This request should time out soon.');
  await field.click();
  await page.locator('.safetyper-icon').click();
  await page.locator('.st-check').click();
  await host.locator('.st-retry').waitFor({ timeout: 8000 });
  const timeoutText = await host.locator('.st-error').innerText();
  assert(/taking too long/i.test(timeoutText), `timeout copy was ${timeoutText}`);
  assert(!/CPU/i.test(timeoutText), `timeout copy was ${timeoutText}`);
  await host.screenshot({ path: path.join(shots, 'card-timeout-error.png') });
  await page.keyboard.press('Escape');

  await field.fill('Translate this hanging sentence please.');
  await field.click();
  await page.keyboard.press('Control+A');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const show = globalThis.__safetyperShowTranslation;
        if (typeof show !== 'function') throw new Error('selection translator is not installed');
        show('Translate this hanging sentence please.');
      },
    });
  });
  const bubble = page.locator('[data-safetyper-translate="bubble"]');
  await bubble.locator('.tr-retry').waitFor({ timeout: 8000 });
  const bubbleText = await bubble.locator('.tr-error').innerText();
  assert(/taking too long/i.test(bubbleText), `bubble timeout copy was ${bubbleText}`);
  assert(!/CPU/i.test(bubbleText), `bubble copy was ${bubbleText}`);
  await bubble.screenshot({ path: path.join(shots, 'translate-timeout-error.png') });

  await setMode('reply');
  await worker.evaluate(() => {
    delete globalThis.__SAFETYPER_TIMEOUT_MS;
  });
  const extensionId = new URL(worker.url()).host;
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });
  await editor.getByRole('button', { name: 'New document' }).click();
  const prose = editor.locator('.safetyper-prose');
  await prose.waitFor({ timeout: 8000 });
  await prose.click();
  await editor.keyboard.type('hello');
  await editor.getByRole('button', { name: 'Check', exact: true }).click();
  await editor.locator('.banner.ok', { hasText: 'Looks good' }).waitFor({ timeout: 8000 });
  await editor.screenshot({ path: path.join(shots, 'editor-looks-good-hello.png') });
  console.log('timeout and dismiss checks passed');
} finally {
  await context.close();
  pageServer.kill();
  stub.closeAllConnections?.();
  await new Promise((resolve) => stub.close(() => resolve()));
}
