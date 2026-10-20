/**
 * Loads the unpacked extension and checks the grammar icon does not cover
 * the obstacles on the placement lab in src/entrypoints/test/index.html.
 *
 * Requires a production build (.output/chrome-mv3), playwright-core, and Chrome.
 *   CHROME=/path/to/chrome node scripts/check-icon-placement.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, '.output/chrome-mv3');
const pageDir = path.join(root, 'src/entrypoints/test');
const chrome =
  process.env.CHROME || '/home/ubuntu/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const port = 8788;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: pageDir,
  stdio: 'ignore',
});

const defaultDisabled =
  '--disable-features=AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument';

const context = await chromium.launchPersistentContext(`/tmp/pw-icon-check-${Date.now()}`, {
  headless: false,
  executablePath: chrome,
  viewport: { width: 1100, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions', defaultDisabled],
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    `${defaultDisabled},DisableLoadExtensionCommandLineSwitch`,
    '--no-first-run',
    '--disable-dev-shm-usage',
  ],
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });

const page = await context.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

const cases = [
  'pm-inline',
  'pm-shadow',
  'show-password',
  'search-clear',
  'chat-composer',
  'char-counter',
  'rich-editor',
  'tiny-input',
  'rtl-input',
  'fixed-header',
  'scroll-container',
  'iframe-field',
  'late-icon',
  'real-password',
];

function overlaps(a, b) {
  return (
    a.x < b.x + b.width - 1 &&
    a.x + a.width > b.x + 1 &&
    a.y < b.y + b.height - 1 &&
    a.y + a.height > b.y + 1
  );
}

const failures = [];
for (const name of cases) {
  if (name === 'iframe-field') {
    await page.frameLocator('#placement-iframe').locator('#iframe-input').click();
  } else if (name === 'scroll-container') {
    await page.locator('#scroll-box').evaluate((el) => {
      el.querySelector('input')?.scrollIntoView({ block: 'center' });
    });
    await page.locator('[data-case="scroll-container"] [data-field]').click();
  } else if (name === 'real-password') {
    await page.locator('#real-password').click();
  } else {
    await page.locator(`[data-case="${name}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-case="${name}"] [data-field]`).first().click();
  }
  await page.waitForTimeout(name === 'late-icon' ? 900 : 350);

  const scope = name === 'iframe-field' ? page.frameLocator('#placement-iframe') : page;
  const visible = await scope.locator('.safetyper-icon').evaluateAll((els) =>
    els.some((el) => getComputedStyle(el).display !== 'none')
  );
  const iconBox = visible ? await scope.locator('.safetyper-icon').boundingBox() : null;
  const obstacles = scope.locator('[data-obstacle]');
  const hits = [];
  const count = await obstacles.count();
  for (let i = 0; i < count; i++) {
    const box = await obstacles.nth(i).boundingBox();
    if (iconBox && box && overlaps(iconBox, box)) hits.push(i);
  }
  if (name === 'real-password' && visible) failures.push('real-password: icon should stay hidden');
  if (name !== 'real-password' && !visible) failures.push(`${name}: icon not visible`);
  if (hits.length) failures.push(`${name}: overlaps obstacle ${hits.join(',')}`);
  console.log(name, visible ? 'visible' : 'hidden', hits.length ? `overlap ${hits}` : 'clear');
}

await context.close();
server.kill();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('icon placement check passed', new URL(worker.url()).host);
