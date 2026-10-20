/**
 * Card actions against a local chat-completions stub.
 * Suggests nothing from a real model. Screenshots land in SUGGESTION_SHOTS.
 *
 *   CHROME=/opt/google/chrome/chrome node scripts/check-card-actions.mjs
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
const chromeCandidates = [
  process.env.CHROME,
  '/home/ubuntu/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  '/home/ubuntu/.cache/ms-playwright/chromium-1187/chrome-linux/chrome',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  throw new Error('Set CHROME to a Chromium build that still accepts --load-extension');
}
const pagePort = 8804;
const stubPort = 8805;

const REPLACEMENTS = [
  ['Teh', 'The', 'spelling', "Corrected 'Teh' to 'The'."],
  ['has several', 'have several', 'grammar', "The subject takes 'have'."],
  ['problem', 'problems', 'grammar', "Use the plural 'problems'."],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text, term) {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(term)}(?![A-Za-z])`).test(text);
}

let lastSystem = '';

const stub = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/last') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ system: lastSystem }));
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
    let content = '{"issues":[]}';
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const system = payload.messages?.find((message) => message.role === 'system')?.content || '';
      lastSystem = system;
      const user = (payload.messages || [])
        .filter((message) => message.role === 'user')
        .map((message) => message.content || '')
        .join('\n');
      const issues = [];
      for (const [quote, replacement, category, explanation] of REPLACEMENTS) {
        if (!hasTerm(user, quote)) continue;
        issues.push({ quote, replacement, category, explanation });
      }
      content = JSON.stringify({ issues });
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

const defaultDisabled =
  '--disable-features=AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function shot(locator, file) {
  await locator.screenshot({ path: path.join(shots, file) });
}

const failures = [];

try {
  const context = await chromium.launchPersistentContext(`/tmp/pw-card-actions-${Date.now()}`, {
    headless: false,
    executablePath: chrome,
    viewport: { width: 1400, height: 1000 },
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
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  await worker.evaluate(async (endpoint) => {
    await chrome.storage.local.set({
      selectedProvider: 'ollama',
      ollamaEndpoint: endpoint,
      ollamaSelectedModel: 'stub',
      darkMode: false,
      hasCompletedOnboarding: true,
      customSystemPrompt: '',
      personalDictionary: [],
      disabledGroups: [],
      popupTab: 'settings',
    });
  }, `http://127.0.0.1:${stubPort}`);

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${pagePort}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const field = page.locator('#suggestion-sample');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  const icon = page.locator('.safetyper-icon');
  await icon.waitFor({ state: 'visible', timeout: 8000 });
  await icon.click();
  const check = page.locator('.st-check');
  await check.waitFor({ state: 'visible', timeout: 8000 });
  await check.click();

  const host = page.locator('.safetyper-popup-host');
  const spelling = host.locator('.st-card[data-category="spelling"]');
  await spelling.waitFor({ timeout: 8000 });
  const addButton = spelling.locator('button', { hasText: 'Add to dictionary' });
  await addButton.waitFor();
  assert((await host.locator('.st-card').count()) === 3, 'sample opens three cards');
  assert(
    !(await host.locator('.st-card[data-category="grammar"]').locator('text=Add to dictionary').count()),
    'grammar cards do not offer the dictionary'
  );

  await page.waitForFunction(() => {
    const popup = document.querySelector('.safetyper-popup-host');
    return popup?.shadowRoot?.activeElement?.classList.contains('st-btn-primary') === true;
  });
  await page.keyboard.press('ArrowDown');
  const moved = await host.evaluate((element) => {
    const active = element.shadowRoot?.activeElement;
    return active?.closest('.st-card')?.getAttribute('aria-label') || '';
  });
  assert(moved.includes('has several'), `arrow down moves to the next card, got ${moved}`);
  await page.keyboard.press('ArrowUp');
  const back = await host.evaluate((element) => {
    const active = element.shadowRoot?.activeElement;
    return active?.closest('.st-card')?.getAttribute('data-category') || '';
  });
  assert(back === 'spelling', `arrow up returns to the spelling card, got ${back}`);

  await shot(spelling, 'card-add-to-dictionary.png');
  await addButton.click();
  await host.locator('text=Added "Teh" to your dictionary.').waitFor({ timeout: 4000 });
  assert((await host.locator('.st-card[data-category="spelling"]').count()) === 0, 'the spelling card is gone');
  assert((await host.locator('.st-card').count()) === 2, 'other cards stay');
  const storedWord = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('personalDictionary');
    return stored.personalDictionary || [];
  });
  assert(
    storedWord.some((word) => word.toLowerCase() === 'teh'),
    `dictionary stored the word, got ${storedWord.join(',')}`
  );
  const focusedAfter = await host.evaluate((element) => {
    const active = element.shadowRoot?.activeElement;
    return active?.closest('.st-card')?.getAttribute('aria-label') || '';
  });
  assert(focusedAfter.includes('has several'), `focus moves to the next card, got ${focusedAfter}`);
  await shot(host, 'card-after-dictionary.png');

  await page.keyboard.press('Escape');
  await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

  await worker.evaluate(() => chrome.storage.local.set({ disabledGroups: ['correctness'] }));
  await field.click();
  await icon.click();
  await page.locator('.st-check').click();
  await host.locator('.st-done', { hasText: 'Nothing left to review.' }).waitFor({ timeout: 8000 });
  assert((await host.locator('.st-card').count()) === 0, 'turned-off correctness and the dictionary hide every card');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

  await worker.evaluate(() => chrome.storage.local.set({ disabledGroups: [] }));
  await field.click();
  await icon.click();
  await page.locator('.st-check').click();
  await host.locator('.st-card').first().waitFor({ timeout: 8000 });
  const quotes = await host.locator('.st-category').allInnerTexts();
  assert(!quotes.map((value) => value.trim().toLowerCase()).includes('spelling'), 'Teh stays out of the next check');
  assert((await host.locator('.st-card').count()) === 2, 'correctness cards return when the group is on');
  assert(
    lastSystem.includes('Do not flag these words: Teh'),
    `prompt hint missing from the local stub: ${lastSystem}`
  );

  await host.locator('.st-card', { hasText: 'problem' }).locator('button', { hasText: 'Dismiss' }).click();
  assert((await host.locator('.st-card').count()) === 1, 'dismiss removes the card');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });
  await field.click();
  await icon.click();
  await page.locator('.st-check').click();
  await host.locator('.st-card').first().waitFor({ timeout: 8000 });
  assert((await host.locator('.st-card', { hasText: 'problem' }).count()) === 0, 'dismiss sticks for this field');
  assert((await host.locator('.st-card', { hasText: 'has several' }).count()) === 1, 'other text still suggests');
  await host.locator('.st-accept-all').click();
  await host.locator('.st-done').waitFor({ timeout: 4000 });
  const finished = await field.inputValue();
  assert(
    finished === 'Teh meeting notes from yesterday have several problem that we should fix.',
    `accept all kept the dictionary word and the dismissal, got ${finished}`
  );

  await worker.evaluate(() =>
    chrome.storage.local.set({
      popupTab: 'settings',
      disabledGroups: ['engagement'],
      personalDictionary: ['recieve', 'sentance', 'colour'],
    })
  );
  const extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const dictionary = settings.locator('#dictionary-section');
  await dictionary.waitFor({ timeout: 8000 });
  await settings.locator('#dictionary-search').fill('sen');
  await settings.locator('.word-row', { hasText: 'sentance' }).waitFor();
  assert((await settings.locator('.word-row').count()) === 1, 'search filters the dictionary');
  await settings.locator('#dictionary-search').fill('');
  await settings.locator('input[type="file"]').setInputFiles({
    name: 'words.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('# note\nwidget\nsentance\n'),
  });
  await settings.locator('text=Imported 1 word.').waitFor({ timeout: 4000 });
  await settings.locator('.word-row', { hasText: 'colour' }).locator('button', { hasText: 'Remove' }).click();
  await settings.locator('.word-row', { hasText: 'widget' }).waitFor();
  assert((await settings.locator('.word-row', { hasText: 'colour' }).count()) === 0, 'remove drops the word');
  const importLabel = await settings.locator('#dictionary-section button', { hasText: 'Import' }).innerText();
  const exportLabel = await settings.locator('#dictionary-section button', { hasText: 'Export' }).innerText();
  assert(importLabel === 'Import .txt', `import label was ${importLabel}`);
  assert(exportLabel === 'Export .txt', `export label was ${exportLabel}`);
  await shot(settings.locator('#dictionary-section .button-row'), 'dictionary-buttons-fixed.png');
  await shot(dictionary, 'settings-dictionary.png');

  const categories = settings.locator('#category-section');
  const engagementBox = categories.locator('.check-row', { hasText: 'Engagement' }).locator('input');
  const correctnessBox = categories.locator('.check-row', { hasText: 'Correctness' }).locator('input');
  assert((await engagementBox.isChecked()) === false, 'engagement starts off');
  assert(await correctnessBox.isChecked(), 'correctness stays on');
  await categories.locator('.check-row', { hasText: 'Clarity' }).locator('input').click();
  const turnedOff = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('disabledGroups');
    return stored.disabledGroups || [];
  });
  assert(
    turnedOff.includes('clarity') && turnedOff.includes('engagement'),
    `groups saved ${turnedOff.join(',')}`
  );
  await categories.locator('.check-row', { hasText: 'Clarity' }).locator('input').click();
  await categories.locator('#category-heading').click();
  await shot(categories, 'settings-categories.png');

  await context.close();
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  stub.close();
  pageServer.kill();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('card action checks passed');
