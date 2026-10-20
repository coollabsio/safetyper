/**
 * Screenshot the redesigned in-field icon against a local chat-completions stub.
 *
 *   CHROME=/path/to/chrome node scripts/check-icon-states.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, '.output/chrome-mv3');
const beforeExt = process.env.BEFORE_EXT || '';
const pageDir = path.join(root, 'src/entrypoints/test');
const shots = process.env.ICON_SHOTS || '/opt/cursor/artifacts';
const chrome =
  process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const pagePort = 8802;
const stubPort = 8803;

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
      if (system.includes('"issues"')) {
        const issues = [];
        for (const [quote, replacement, category, explanation] of REPLACEMENTS) {
          if (!hasTerm(user, quote)) continue;
          issues.push({ quote, replacement, category, explanation });
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launch(extensionDir, label) {
  const context = await chromium.launchPersistentContext(`/tmp/pw-icon-states-${label}-${Date.now()}`, {
    headless: false,
    executablePath: chrome,
    viewport: { width: 1200, height: 1100 },
    deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--disable-dev-shm-usage',
    ],
  });
  let worker = context.serviceWorkers().find((item) => item.url().includes('/background.js'));
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', {
      predicate: (item) => item.url().includes('/background.js'),
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
      autoCheckEnabled: true,
      autoCheckDisabledHosts: [],
      iconSize: 'medium',
    });
  }, `http://127.0.0.1:${stubPort}`);
  const page = await context.newPage();
  return { context, page, worker };
}

async function armField(page) {
  const field = page.locator('#icon-live');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await page.locator('.safetyper-icon').waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
}

async function zoomIcon(page, file) {
  const icon = page.locator('.safetyper-icon');
  const box = await icon.boundingBox();
  assert(box, 'icon box');
  const pad = 18;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
  const raw = path.join(shots, `${file}.raw.png`);
  await page.screenshot({ path: raw, clip });
  execFileSync('python3', [
    '-c',
    `
from PIL import Image
im = Image.open(${JSON.stringify(raw)})
# Capture is already 2x. Nearest-neighbor 2x more makes each CSS pixel 4 image pixels.
im.resize((im.width * 2, im.height * 2), Image.Resampling.NEAREST).save(${JSON.stringify(path.join(shots, file))})
`,
  ]);
  return box;
}

const failures = [];
try {
  if (beforeExt) {
    const before = await launch(beforeExt, 'before');
    try {
      await before.page.goto(`http://127.0.0.1:${pagePort}/index.html`, {
        waitUntil: 'domcontentloaded',
      });
      await armField(before.page);
      await before.page.locator('.safetyper-badge.is-visible').waitFor({ timeout: 12000 });
      await zoomIcon(before.page, 'icon-before-zoom.png');
    } finally {
      await before.context.close();
    }
  }

  const session = await launch(extPath, 'after');
  const { page, worker } = session;
  try {
    await page.goto(`http://127.0.0.1:${pagePort}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#icon-state-gallery figure').first().waitFor({ timeout: 8000 });
    assert(
      (await page.locator('#icon-state-gallery figure').count()) >= 12,
      'light gallery lists the states'
    );
    assert(
      (await page.locator('#icon-state-gallery-dark figure').count()) >= 12,
      'dark gallery lists the states'
    );
    await page.locator('#icon-state-gallery').screenshot({
      path: path.join(shots, 'icon-states-overview-light.png'),
    });
    await page.locator('.icon-gallery-dark').screenshot({
      path: path.join(shots, 'icon-states-overview-dark.png'),
    });

    await page.addStyleTag({ content: 'button { background: red !important; }' });
    await armField(page);
    const icon = page.locator('.safetyper-icon');
    await icon.waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('.safetyper-icon')?.getAttribute('data-presentation') === 'count',
      null,
      { timeout: 12000 }
    );
    const label = await icon.locator('.face').getAttribute('aria-label');
    assert(label && label.includes('suggestion'), `aria-label was ${label}`);
    const faceBg = await icon.locator('.face').evaluate((element) => getComputedStyle(element).backgroundColor);
    assert(!faceBg.includes('255, 0, 0'), 'page button styles do not paint the icon');
    const fieldBox = await page.locator('#icon-live').boundingBox();
    const iconBox = await icon.boundingBox();
    assert(fieldBox && iconBox, 'live field');
    await page.screenshot({
      path: path.join(shots, 'icon-in-field-issues.png'),
      clip: {
        x: Math.max(0, Math.min(fieldBox.x, iconBox.x) - 12),
        y: Math.max(0, Math.min(fieldBox.y, iconBox.y) - 36),
        width: Math.max(fieldBox.x + fieldBox.width, iconBox.x + iconBox.width) + 24 -
          Math.max(0, Math.min(fieldBox.x, iconBox.x) - 12),
        height: Math.max(fieldBox.y + fieldBox.height, iconBox.y + iconBox.height) + 20 -
          Math.max(0, Math.min(fieldBox.y, iconBox.y) - 36),
      },
    });
    await zoomIcon(page, 'icon-after-zoom.png');
    await icon.hover();
    await page.waitForTimeout(150);
    const tip = await icon.locator('.tip').innerText();
    assert(tip.includes('suggestion'), `tooltip was ${tip}`);
    const hoverBox = await icon.boundingBox();
    await page.screenshot({
      path: path.join(shots, 'icon-hover-tooltip.png'),
      clip: {
        x: Math.max(0, hoverBox.x - 70),
        y: Math.max(0, hoverBox.y - 40),
        width: 180,
        height: 90,
      },
    });

    const popupUrl = await worker.evaluate(() => chrome.runtime.getURL('/popup.html'));
    const popup = await session.context.newPage();
    await popup.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await popup.locator('#tab-settings').click();
    await popup.locator('.icon-size').waitFor({ timeout: 8000 });
    const sizeBox = await popup.locator('.icon-size').boundingBox();
    assert(sizeBox, 'icon size control');
    await popup.screenshot({
      path: path.join(shots, 'icon-settings-size.png'),
      clip: {
        x: Math.max(0, sizeBox.x - 16),
        y: Math.max(0, sizeBox.y - 36),
        width: Math.min(420, sizeBox.width + 32),
        height: 110,
      },
    });
    await popup.close();

    await worker.evaluate(() => chrome.storage.local.set({ iconSize: 'hidden' }));
    await page.bringToFront();
    await page.waitForTimeout(200);
    const hidden = await icon.evaluate((element) => getComputedStyle(element).display === 'none');
    assert(hidden, 'hidden setting removes the icon');
    const bars = await page.locator('.safetyper-underline-bar').count();
    assert(bars >= 1, 'underlines stay while the icon is hidden');
    await page.locator('#icon-live').click();
    await page.keyboard.press('Alt+Shift+S');
    await page.locator('.safetyper-popup-host').waitFor({ timeout: 4000 });
  } finally {
    await session.context.close();
  }

  if (beforeExt) {
    execFileSync('python3', [
      '-c',
      `
from PIL import Image, ImageDraw
old = Image.open('${path.join(shots, 'icon-before-zoom.png')}')
new = Image.open('${path.join(shots, 'icon-after-zoom.png')}')
h = max(old.height, new.height)
canvas = Image.new('RGB', (old.width + new.width + 36, h + 36), 'white')
canvas.paste(old, (12, 28))
canvas.paste(new, (old.width + 24, 28))
draw = ImageDraw.Draw(canvas)
draw.text((12, 6), 'Before', fill='#18181b')
draw.text((old.width + 24, 6), 'After', fill='#18181b')
canvas.save('${path.join(shots, 'before-after-icon.png')}')
`,
    ]);
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
console.log('icon state checks passed');
