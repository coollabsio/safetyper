/**
 * Exercise opt-in auto-check against a local chat-completions stub.
 *
 *   CHROME=/opt/google/chrome/chrome node scripts/check-auto-check.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, '.output/chrome-mv3');
const pageDir = path.join(root, 'src/entrypoints/test');
const shots = process.env.AUTO_CHECK_SHOTS || '/opt/cursor/artifacts';
const chrome =
  process.env.CHROME ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const pagePort = 8798;
const stubPort = 8799;

const REPLACEMENTS = [
  ['Teh', 'The', 'spelling', "Corrected 'Teh' to 'The'."],
  ['has several', 'have several', 'grammar', "The subject takes 'have'."],
  ['problem', 'problems', 'grammar', "Use the plural 'problems'."],
  ['sentance', 'sentence', 'spelling', "Corrected 'sentance' to 'sentence'."],
  ['grammer', 'grammar', 'spelling', "Corrected 'grammer' to 'grammar'."],
  ['dont', "don't", 'punctuation', 'Added an apostrophe.'],
  ['their are', 'there are', 'grammar', "Use 'there are'."],
  ['inapropriate', 'inappropriate', 'spelling', 'Corrected the spelling.'],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text, term) {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(term)}(?![A-Za-z])`).test(text);
}

const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let content = '{"issues":[]}';
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const system = payload.messages?.find((message) => message.role === 'system')?.content || '';
      const user = (payload.messages || [])
        .filter((message) => message.role === 'user')
        .map((message) => message.content || '')
        .join('\n');
      const wantsJson = system.includes('"issues"');
      if (wantsJson) {
        const issues = [];
        for (const [quote, replacement, category, explanation] of REPLACEMENTS) {
          if (!hasTerm(user, quote)) continue;
          issues.push({ quote, replacement, category, explanation });
          if (issues.length === 8) break;
        }
        content = JSON.stringify({ issues });
      }
    } catch (error) {
      content = String(error);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));

const pageServer = spawn('python3', ['-m', 'http.server', String(pagePort), '--bind', '127.0.0.1'], {
  cwd: pageDir,
  stdio: 'ignore',
});

function isBackground(worker) {
  return worker.url().includes('/background.js');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const context = await chromium.launchPersistentContext(`/tmp/pw-auto-check-${Date.now()}`, {
  headless: false,
  executablePath: chrome,
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--disable-dev-shm-usage',
  ],
});

const failures = [];

try {
  let worker = context.serviceWorkers().find(isBackground);
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', {
      predicate: isBackground,
      timeout: 15000,
    });
  }
  await worker.evaluate(async (endpoint) => {
    await chrome.storage.local.set({
      selectedProvider: 'ollama',
      ollamaEndpoint: endpoint,
      ollamaSelectedModel: 'stub',
      darkMode: false,
      hasCompletedOnboarding: true,
      customSystemPrompt: '',
      autoCheckEnabled: false,
      autoCheckDisabledHosts: [],
    });
  }, `http://127.0.0.1:${stubPort}`);

  const popupUrl = await worker.evaluate(() => chrome.runtime.getURL('/popup.html'));
  const page = await context.newPage();
  await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#tab-settings').click();
  const toggle = page.locator('#auto-check');
  await toggle.waitFor({ timeout: 8000 });
  assert((await toggle.getAttribute('aria-checked')) === 'false', 'auto-check starts off');
  const note = page.getByText('sent to the selected provider');
  await note.waitFor();
  const appBox = await page.locator('#app').boundingBox();
  assert(appBox, 'popup has a box');
  const settingsClip = {
    x: Math.max(0, appBox.x),
    y: 0,
    width: Math.min(appBox.width, 1100),
    height: 460,
  };
  await page.screenshot({
    path: path.join(shots, 'auto-check-setting-off.png'),
    clip: settingsClip,
  });

  await toggle.click();
  await page.waitForFunction(
    () => document.querySelector('#auto-check')?.getAttribute('aria-checked') === 'true'
  );
  assert(
    (await page.getByText('sent to the selected provider').innerText()).includes('selected provider'),
    'the setting explains that text is sent'
  );
  await page.screenshot({
    path: path.join(shots, 'auto-check-setting-on.png'),
    clip: settingsClip,
  });

  await page.goto(`http://127.0.0.1:${pagePort}/index.html`, { waitUntil: 'domcontentloaded' });
  const field = page.locator('#suggestion-sample');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await page.locator('.safetyper-icon').waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const badge = page.locator('.safetyper-badge.is-visible');
  await badge.waitFor({ timeout: 12000 });
  await page.locator('.safetyper-underline-bar').first().waitFor({ timeout: 8000 });
  const barCount = await page.locator('.safetyper-underline-bar').count();
  assert(barCount >= 2, `expected underlines in the textarea, got ${barCount}`);
  const badgeText = await badge.innerText();
  assert(Number(badgeText) >= 2, `badge count was ${badgeText}`);

  const fieldBox = await field.boundingBox();
  const iconBox = await page.locator('.safetyper-icon').boundingBox();
  assert(fieldBox && iconBox, 'field and icon are visible');
  const union = {
    x: Math.max(0, Math.min(fieldBox.x, iconBox.x) - 16),
    y: Math.max(0, Math.min(fieldBox.y, iconBox.y) - 24),
  };
  union.width = Math.min(
    1100 - union.x,
    Math.max(fieldBox.x + fieldBox.width, iconBox.x + iconBox.width) + 24 - union.x
  );
  union.height = Math.min(
    900 - union.y,
    Math.max(fieldBox.y + fieldBox.height, iconBox.y + iconBox.height) + 24 - union.y
  );
  await page.screenshot({
    path: path.join(shots, 'auto-check-textarea-underlines.png'),
    clip: union,
  });
  const badgeClip = {
    x: Math.max(0, iconBox.x - 12),
    y: Math.max(0, iconBox.y - 16),
    width: iconBox.width + 28,
    height: iconBox.height + 28,
  };
  await page.screenshot({
    path: path.join(shots, 'auto-check-badge.png'),
    clip: badgeClip,
  });

  await page.locator('.safetyper-underline-bar').first().click();
  const card = page.locator('.st-card').first();
  await card.waitFor({ timeout: 8000 });
  const host = page.locator('.safetyper-popup-host');
  const cardBox = await host.boundingBox();
  assert(cardBox, 'suggestion card is open');
  const cardClip = {
    x: Math.max(0, Math.min(fieldBox.x, cardBox.x) - 12),
    y: Math.max(0, Math.min(union.y, cardBox.y) - 12),
  };
  cardClip.width = Math.min(
    1100 - cardClip.x,
    Math.max(fieldBox.x + fieldBox.width, cardBox.x + cardBox.width) + 16 - cardClip.x
  );
  cardClip.height = Math.min(
    900 - cardClip.y,
    Math.max(fieldBox.y + fieldBox.height, cardBox.y + cardBox.height) + 16 - cardClip.y
  );
  await page.screenshot({
    path: path.join(shots, 'auto-check-card-from-underline.png'),
    clip: cardClip,
  });

  const before = await field.inputValue();
  await page.locator('.st-btn-primary').first().click();
  await page.waitForTimeout(250);
  const after = await field.inputValue();
  assert(after !== before, 'accept changes the textarea');
  assert(after.includes('The meeting') || after.includes('have several') || after.includes('problems'), `accepted text was ${after}`);
  await page.screenshot({
    path: path.join(shots, 'auto-check-after-accept.png'),
    clip: union,
  });

  const editable = page.locator('#contentEditable');
  await editable.scrollIntoViewIfNeeded();
  await editable.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await page.waitForFunction(
    () => {
      const highlighted =
        typeof CSS !== 'undefined' &&
        CSS.highlights &&
        [...CSS.highlights.entries()].some(
          ([name, highlight]) => String(name).startsWith('safetyper-') && highlight.size > 0
        );
      return highlighted || document.querySelector('.safetyper-underline-bar');
    },
    null,
    { timeout: 12000 }
  );
  const editableBox = await editable.boundingBox();
  assert(editableBox, 'contenteditable is visible');
  await page.screenshot({
    path: path.join(shots, 'auto-check-contenteditable-underlines.png'),
    clip: {
      x: Math.max(0, editableBox.x - 16),
      y: Math.max(0, editableBox.y - 36),
      width: Math.min(1100, editableBox.width + 80),
      height: Math.min(900, editableBox.height + 56),
    },
  });
  const highlightCount = await page.evaluate(() => {
    if (!CSS.highlights) return 0;
    let count = 0;
    for (const [name, highlight] of CSS.highlights.entries()) {
      if (String(name).startsWith('safetyper-')) count += highlight.size;
    }
    return count;
  });
  const fallbackCount = await page.locator('.safetyper-underline-bar').count();
  assert(highlightCount > 0 || fallbackCount > 0, 'contenteditable has underlines');
  console.log(
    JSON.stringify({ barCount, badgeText, before, after, highlightCount, fallbackCount })
  );
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await context.close();
  stub.close();
  pageServer.kill();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('auto-check screenshots saved');
