/**
 * Exercise the in-page suggestion popup against a local chat-completions stub.
 *
 * Requires a production build in .output/chrome-mv3, playwright-core, and Chrome.
 * Optional BEFORE_EXT points at a build of main (the previous diff popup).
 *
 *   CHROME=/path/to/chrome node scripts/check-suggestions.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, '.output/chrome-mv3');
const beforeExt = process.env.BEFORE_EXT || '';
const pageDir = path.join(root, 'src/entrypoints/test');
const shots = process.env.SUGGESTION_SHOTS || '/opt/cursor/artifacts';
const chrome =
  process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const pagePort = 8794;
const stubPort = 8795;

const REPLACEMENTS = [
  ['Teh', 'The', 'spelling', "Corrected 'Teh' to 'The'."],
  ['has several', 'have several', 'grammar', "The subject takes 'have'."],
  ['problem', 'problems', 'grammar', "Use the plural 'problems'."],
  ['sentance', 'sentence', 'spelling', "Corrected 'sentance' to 'sentence'."],
  ['grammer', 'grammar', 'spelling', "Corrected 'grammer' to 'grammar'."],
  ['dont', "don't", 'punctuation', "Added an apostrophe."],
  ['their are', 'there are', 'grammar', "Use 'there are'."],
  ['inapropriate', 'inappropriate', 'spelling', "Corrected the spelling."],
  ['mispelled', 'misspelled', 'spelling', "Corrected 'mispelled'."],
  ['punctation', 'punctuation', 'spelling', "Corrected 'punctation'."],
  ['extention', 'extension', 'spelling', "Corrected 'extention'."],
  ['everyday', 'every day', 'style', 'Use two words.'],
  ['aream', 'am', 'grammar', "Changed 'aream' to 'am'."],
  ['35 year old', '35-year-old', 'style', 'Hyphenate the compound.'],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text, term) {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(term)}(?![A-Za-z])`).test(text);
}

function correctPassage(text) {
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    next = next.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(from)}(?![A-Za-z])`, 'g'), to);
  }
  return next;
}

function passageOf(user) {
  const marker = 'original:\n\n';
  const index = user.lastIndexOf(marker);
  return index === -1 ? user : user.slice(index + marker.length);
}

let lastSystem = '';

const GROUP_DEMO = [
  {
    quote: 'Teh',
    replacement: 'The',
    group: 'correctness',
    subcategory: 'spelling',
    explanation: 'Correct the spelling of the first word.',
  },
  {
    quote: 'very very',
    replacement: 'very',
    group: 'clarity',
    subcategory: 'wordiness',
    explanation: 'Drop the repeated word.',
  },
  {
    quote: 'good',
    replacement: 'strong',
    group: 'engagement',
    subcategory: 'word-choice',
    explanation: 'Use a more specific word.',
  },
  {
    quote: 'I think maybe',
    replacement: 'Please',
    group: 'delivery',
    subcategory: 'politeness',
    explanation: 'Ask the team directly.',
  },
];

function rewriteFor(system) {
  if (system.includes('Shorten')) return 'Review the short quarterly update.';
  if (system.includes('more formal')) return 'The team is requested to review the quarterly update.';
  if (system.includes('more friendly')) return 'Could the team take a look at the quarterly update?';
  if (system.includes('more confident')) return 'The team will review the quarterly update.';
  return 'The quarterly update is long and repetitive. The team should review it.';
}

const stub = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/tags')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'stub' }] }));
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/last')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ system: lastSystem }));
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
      const passage = passageOf(user);
      if (system.includes('"rewrite"')) {
        content = JSON.stringify({ rewrite: rewriteFor(system) });
      } else if (passage.includes('quarterly update')) {
        content = JSON.stringify({ issues: GROUP_DEMO });
      } else {
        const wantsJson = system.includes('"issues"');
        const plain = passage.includes('aream');
        if (wantsJson && !plain) {
          const issues = [];
          for (const [quote, replacement, category, explanation] of REPLACEMENTS) {
            if (!hasTerm(passage, quote)) continue;
            issues.push({ quote, replacement, category, explanation });
            if (issues.length === 8) break;
          }
          content = JSON.stringify({ issues });
        } else {
          content = correctPassage(passage);
        }
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

const defaultDisabled =
  '--disable-features=AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launch(extensionDir, label) {
  const context = await chromium.launchPersistentContext(`/tmp/pw-suggestions-${label}-${Date.now()}`, {
    headless: false,
    executablePath: chrome,
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
    ignoreDefaultArgs: ['--disable-extensions', defaultDisabled],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `${defaultDisabled},DisableLoadExtensionCommandLineSwitch`,
      '--no-first-run',
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
    });
  }, `http://127.0.0.1:${stubPort}`);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${pagePort}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  return { context, page, worker };
}

async function openCheck(page, fieldSelector) {
  const field = page.locator(fieldSelector).first();
  await field.scrollIntoViewIfNeeded();
  await field.click();
  const icon = page.locator('.safetyper-icon');
  await icon.waitFor({ state: 'visible', timeout: 8000 });
  await icon.click();
  const check = page.locator('.st-check, .safetyper-check-btn').first();
  await check.waitFor({ state: 'visible', timeout: 8000 });
  await check.click();
}

async function shot(locator, file) {
  await locator.screenshot({ path: path.join(shots, file) });
}

async function shotAround(page, locator, file) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${file}`);
  const pad = 16;
  await page.screenshot({
    path: path.join(shots, file),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
}

const failures = [];

try {
  if (beforeExt) {
    const before = await launch(beforeExt, 'before');
    try {
      await before.worker.evaluate(() => chrome.storage.local.set({ darkMode: true }));
      await before.page.reload({ waitUntil: 'domcontentloaded' });
      await before.page.waitForTimeout(300);
      await openCheck(before.page, '.ProseMirror p');
      const popup = before.page.locator('.safetyper-popup');
      await popup.locator('.editor-instruction').waitFor({ timeout: 8000 });
      await shot(popup, 'before-popup.png');
      const warning = await popup.locator('.editor-instruction').innerText();
      assert(warning.includes('Complex editor detected'), 'before popup shows the complex warning');
      assert(await popup.locator('text=Changes:').count(), 'before popup shows the diff');
    } finally {
      await before.context.close();
    }
  }

  const session = await launch(extPath, 'after');
  const { page, worker } = session;
  try {
    await page.addStyleTag({ content: 'button { background: red !important; color: red !important; }' });
    await openCheck(page, '#suggestion-sample');
    const host = page.locator('.safetyper-popup-host');
    await host.locator('.st-card').first().waitFor({ timeout: 8000 });
    const isolated = await host.evaluate((element) => element.shadowRoot !== null);
    assert(isolated, 'popup is in a shadow root');
    const buttonBg = await host.locator('.st-btn-primary').first().evaluate((element) => {
      return getComputedStyle(element).backgroundImage + getComputedStyle(element).backgroundColor;
    });
    assert(!buttonBg.includes('255, 0, 0'), 'page styles do not restyle shadow buttons');

    const count = await host.locator('.st-count').innerText();
    assert(count === '3 suggestions', `expected 3 suggestions, got ${count}`);
    const categories = (await host.locator('.st-category').allInnerTexts()).map((value) =>
      value.trim().toLowerCase()
    );
    assert(
      categories.length === 3 && categories.every((value) => value === 'correctness'),
      `legacy categories render as correctness, got ${categories.join(', ')}`
    );

    const fieldBox = await page.locator('#suggestion-sample').boundingBox();
    const popupBox = await host.boundingBox();
    assert(fieldBox && popupBox, 'field and popup have boxes');
    const overlaps =
      popupBox.x < fieldBox.x + fieldBox.width - 2 &&
      popupBox.x + popupBox.width > fieldBox.x + 2 &&
      popupBox.y < fieldBox.y + fieldBox.height - 2 &&
      popupBox.y + popupBox.height > fieldBox.y + 2;
    assert(!overlaps, 'popup does not cover the textarea');

    await shot(host, 'after-light.png');
    await shot(host.locator('.st-card').first(), 'card-closeup.png');
    const union = {
      x: Math.max(0, Math.min(fieldBox.x, popupBox.x) - 24),
      y: Math.max(0, Math.min(fieldBox.y, popupBox.y) - 48),
    };
    union.width = Math.min(
      1500 - union.x,
      Math.max(fieldBox.x + fieldBox.width, popupBox.x + popupBox.width) + 24 - union.x
    );
    union.height = Math.min(
      1000 - union.y,
      Math.max(fieldBox.y + fieldBox.height, popupBox.y + popupBox.height) + 24 - union.y
    );
    await page.screenshot({ path: path.join(shots, 'textarea-test-page.png'), clip: union });

    await host.locator('.st-card', { hasText: 'problem' }).locator('button', { hasText: 'Dismiss' }).click();
    assert((await host.locator('.st-card').count()) === 2, 'dismiss removes one card');

    const accept = host.locator('.st-btn-primary').first();
    await accept.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const afterOne = await page.locator('#suggestion-sample').inputValue();
    assert(afterOne.startsWith('The meeting'), `accept writes the first fix, got ${afterOne}`);
    assert(afterOne.includes('problem'), 'later suggestions stay in the field');
    await shot(host, 'after-accept-one.png');

    await host.locator('.st-accept-all').click();
    await host.locator('.st-done').waitFor({ timeout: 4000 });
    const done = await host.locator('.st-done').innerText();
    assert(done === 'All done', 'empty list shows All done');
    await shot(host, 'all-done.png');
    const finished = await page.locator('#suggestion-sample').inputValue();
    assert(
      finished === 'The meeting notes from yesterday have several problem that we should fix.',
      `accept all result was ${finished}`
    );
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await worker.evaluate(() => chrome.storage.local.set({ darkMode: true }));
    await page.locator('#suggestion-sample').evaluate((element) => {
      element.value = 'Teh meeting notes from yesterday has several problem that we should fix.';
    });
    await openCheck(page, '#suggestion-sample');
    await host.locator('.st-card').first().waitFor({ timeout: 8000 });
    const theme = await host.locator('.st-root').getAttribute('data-theme');
    assert(theme === 'dark', 'dark theme reaches the shadow root');
    await shot(host, 'after-dark.png');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await worker.evaluate(() => chrome.storage.local.set({ darkMode: false }));
    const complexBefore = await page.locator('.ProseMirror').innerText();
    await openCheck(page, '.ProseMirror p');
    await host.locator('text=Copy fixed text').first().waitFor({ timeout: 8000 });
    const notice = await host.locator('.st-notice').innerText();
    assert(notice.includes('cannot be edited directly'), 'complex editors get a small notice');
    assert((await host.locator('.editor-instruction').count()) === 0, 'yellow warning is gone');
    await shot(host, 'complex-editor.png');
    await host.locator('text=Copy fixed text').first().click();
    await page.waitForTimeout(200);
    const complexAfter = await page.locator('.ProseMirror').innerText();
    assert(complexAfter === complexBefore, 'complex editor text is not rewritten');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await openCheck(page, '#fallback-sample');
    await host.locator('.st-card').first().waitFor({ timeout: 8000 });
    const fallbackCount = await host.locator('.st-card').count();
    assert(fallbackCount >= 2, 'plain corrected text becomes grouped diff cards');
    await host.locator('.st-accept-all').click();
    const fallbackValue = await page.locator('#fallback-sample').inputValue();
    assert(
      fallbackValue === 'I am a 35-year-old man.',
      `diff fallback apply was ${fallbackValue}`
    );
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await openCheck(page, '#contentEditable');
    await host.locator('.st-card').first().waitFor({ timeout: 8000 });
    const editableBefore = await page.locator('#contentEditable').innerText();
    await host.locator('.st-btn-primary').first().click();
    await page.waitForTimeout(150);
    const editableAfter = await page.locator('#contentEditable').innerText();
    assert(editableAfter !== editableBefore, 'simple contenteditable accepts a card');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await page.locator('#shortText').scrollIntoViewIfNeeded();
    await page.locator('#shortText').evaluate((element) => {
      element.focus();
      const start = element.value.indexOf('grammer');
      element.setSelectionRange(start, start + 'grammer'.length);
    });
    await page.locator('.safetyper-icon').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('.safetyper-icon').click();
    await page.locator('.st-check').click();
    await host.locator('.st-card').first().waitFor({ timeout: 8000 });
    assert((await host.locator('.st-card').count()) === 1, 'a selection checks only that selection');
    await host.locator('.st-btn-primary').first().click();
    const selected = await page.locator('#shortText').inputValue();
    assert(
      selected.includes('grammar') && !selected.includes('grammer'),
      `selection accept was ${selected}`
    );
    assert(selected.startsWith('This is a sentence'), 'text outside the selection stays');

    await worker.evaluate(() =>
      chrome.storage.local.set({
        darkMode: false,
        writingGoals: {
          audience: 'expert',
          formality: 'formal',
          domain: 'academic',
          intent: 'convince',
        },
      })
    );
    const groupPassage =
      'Teh quarterly update is very very long, the word good shows up too often, and I think maybe the team should review it.';
    await page.locator('#suggestion-sample').evaluate((element, value) => {
      element.value = value;
    }, groupPassage);
    await openCheck(page, '#suggestion-sample');
    await host.locator('.st-card').nth(3).waitFor({ timeout: 8000 });
    const groups = await host.locator('.st-card').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-group'))
    );
    assert(
      groups.join(',') === 'correctness,clarity,engagement,delivery',
      `expected four groups, got ${groups.join(',')}`
    );
    const borders = await host.locator('.st-card').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).borderLeftColor)
    );
    assert(new Set(borders).size === 4, `accents should differ, got ${borders.join(' | ')}`);
    const chipText = (await host.locator('.st-chip').allInnerTexts()).join(' ');
    assert(chipText.includes('Correctness'), 'correctness chip');
    assert(chipText.includes('Clarity'), 'clarity chip');
    assert(chipText.includes('Engagement'), 'engagement chip');
    assert(chipText.includes('Delivery'), 'delivery chip');
    const prompted = await fetch(`http://127.0.0.1:${stubPort}/last`).then((response) =>
      response.json()
    );
    assert(prompted.system.includes('expert readers'), 'goals audience reaches the prompt');
    assert(prompted.system.includes('Formality: formal'), 'goals formality reaches the prompt');
    assert(prompted.system.includes('academic writing'), 'goals domain reaches the prompt');
    assert(prompted.system.includes('convince the reader'), 'goals intent reaches the prompt');
    assert(prompted.system.includes('"subcategory"'), 'check prompt asks for a subcategory');
    await shot(host, 'cards-groups-light.png');

    await host.locator('.st-chip', { hasText: 'Clarity' }).click();
    assert((await host.locator('.st-card').count()) === 1, 'clarity filter shows one card');
    assert(
      (await host.locator('.st-card').getAttribute('data-group')) === 'clarity',
      'filtered card is clarity'
    );
    await shot(host, 'filter-chips.png');

    await host.locator('.st-chip', { hasText: 'All' }).click();
    await host.locator('.st-rewrite').click();
    await host.locator('.st-menu-item', { hasText: 'Shorten' }).waitFor({ timeout: 4000 });
    await shot(host, 'rewrite-menu.png');
    await host.locator('.st-menu-item', { hasText: 'Improve clarity' }).click();
    await host.locator('.st-rewrite-card').waitFor({ timeout: 8000 });
    const rewriteText = (await host.locator('.st-rewrite-text').innerText()).trim();
    assert(
      rewriteText === 'The quarterly update is long and repetitive. The team should review it.',
      `rewrite card text was ${rewriteText}`
    );
    await shot(host, 'rewrite-card.png');
    await host.locator('.st-rewrite-card').locator('button', { hasText: 'Accept' }).click();
    await page.waitForTimeout(200);
    const rewritten = await page.locator('#suggestion-sample').inputValue();
    assert(rewritten === rewriteText, `accept rewrite wrote ${rewritten}`);
    await page.waitForSelector('.safetyper-popup-host', { state: 'detached', timeout: 4000 });

    await worker.evaluate(() => chrome.storage.local.set({ darkMode: true }));
    await page.locator('#suggestion-sample').evaluate((element, value) => {
      element.value = value;
    }, groupPassage);
    await openCheck(page, '#suggestion-sample');
    await host.locator('.st-card').nth(3).waitFor({ timeout: 8000 });
    const darkTheme = await host.locator('.st-root').getAttribute('data-theme');
    assert(darkTheme === 'dark', 'dark theme reaches the grouped cards');
    const darkBorders = await host.locator('.st-card').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).borderLeftColor)
    );
    assert(new Set(darkBorders).size === 4, `dark accents should differ, got ${darkBorders.join(' | ')}`);
    await shot(host, 'cards-groups-dark.png');
    await page.keyboard.press('Escape');

    const extensionId = new URL(worker.url()).host;
    const settings = await session.context.newPage();
    await settings.setViewportSize({ width: 460, height: 980 });
    await worker.evaluate(() =>
      chrome.storage.local.set({ popupTab: 'settings', darkMode: false })
    );
    await settings.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
    });
    await settings.locator('#goal-audience').waitFor({ timeout: 8000 });
    assert(
      (await settings.locator('#goal-audience').inputValue()) === 'expert',
      'settings shows the saved audience'
    );
    await settings.locator('#goal-audience').selectOption('knowledgeable');
    await settings.locator('#goal-formality').selectOption('informal');
    await settings.locator('#goal-domain').selectOption('email');
    await settings.locator('#goal-intent').selectOption('tell-a-story');
    await settings.getByRole('button', { name: 'Save Settings' }).click();
    await settings.locator('.save-feedback').waitFor({ timeout: 4000 });
    await settings.reload({ waitUntil: 'domcontentloaded' });
    await settings.locator('#goal-intent').waitFor({ timeout: 8000 });
    assert(
      (await settings.locator('#goal-intent').inputValue()) === 'tell-a-story',
      'intent persists after reload'
    );
    assert(
      (await settings.locator('#goal-domain').inputValue()) === 'email',
      'domain persists after reload'
    );
    await settings.locator('.goals').scrollIntoViewIfNeeded();
    await shotAround(settings, settings.locator('.goals'), 'goals-settings-light.png');
    await settings.getByRole('button', { name: 'Switch to dark mode' }).click();
    await settings.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'dark'
    );
    await settings.locator('.goals').scrollIntoViewIfNeeded();
    await shotAround(settings, settings.locator('.goals'), 'goals-settings-dark.png');
  } finally {
    await session.context.close();
  }
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
console.log('suggestion popup checks passed');
