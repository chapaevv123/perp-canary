/* global fetch, window, document */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.CANARY_PUBLIC_URL;
assert.ok(base && /^https:\/\/[a-z0-9.-]+$/i.test(base), 'Exact CANARY_PUBLIC_URL HTTPS origin required');
const paths = [process.env.CANARY_BROWSER_PATH,
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', chromium.executablePath()].filter(Boolean);
const executablePath = paths.find(existsSync);
assert.ok(executablePath, 'Chromium browser required');
const result = { url: base, mode: 'PUBLIC_HTTPS_READ_ONLY', walletIdentity: 'READ_ONLY_TEST_PROVIDER',
  ordersSent: 0, signatures: 0 };
const health = await fetch(`${base}/api/v1/health`);
assert.equal(health.status, 200);
assert.match(health.headers.get('strict-transport-security') ?? '', /max-age/);
result.health = await health.json();
const crossOrigin = await fetch(`${base}/api/v1/intelligence/size`, { method: 'POST',
  headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}' });
assert.equal(crossOrigin.status, 403);
const forbidden = await fetch(`${base}/api/v1/bot-execution`);
assert.equal(forbidden.status, 403);
result.security = { crossOriginPost: crossOrigin.status, forbiddenRoute: forbidden.status };

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => { window.ethereum = { on() {}, async request({ method }) {
    if (method === 'eth_accounts') return ['0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42'];
    if (method === 'eth_chainId') return '0xc4cf';
    throw Error('Public smoke is read-only: signing and sending are blocked');
  } }; });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('#market-select option[value="ETH-PERP"]').waitFor({ state: 'attached', timeout: 90_000 });
  await page.waitForFunction(() => !document.getElementById('refresh').disabled,
    undefined, { timeout: 90_000 });
  result.registry = await page.locator('#market-select option[value$="-PERP"]').count();
  result.staticAssets = await page.locator('#workspace-radar').count() === 1;
  result.btcBook = await page.locator('#book-status').textContent();
  result.chartSource = await page.locator('#chart-source').textContent();
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/m9-public-preview-terminal.png', fullPage: true });

  await page.locator('#market-select').selectOption('ETH-PERP');
  await page.waitForFunction(() => document.querySelector('.chart-panel h2')?.textContent?.includes('ETH-PERP'),
    undefined, { timeout: 30_000 });
  await page.waitForFunction(() => !document.getElementById('refresh').disabled,
    undefined, { timeout: 90_000 });
  result.ethBook = await page.locator('#book-status').textContent();
  await page.locator('#workspace-radar').click();
  if (process.env.CANARY_PUBLIC_SKIP_RADAR !== '1') {
    await page.locator('#radar-scan').click();
    await page.waitForFunction(() => !document.getElementById('radar-scan').disabled,
      undefined, { timeout: 240_000 });
    result.radar = { rows: await page.locator('#radar-rows tr').count(),
      scored: await page.locator('#radar-rows tr').filter({ hasText: /\/100/ }).count(),
      progress: await page.locator('#radar-progress').textContent() };
    await page.screenshot({ path: 'docs/screenshots/m9-public-preview-radar.png', fullPage: true });
  }

  await page.locator('#workspace-alerts').click();
  await page.locator('#alert-market').selectOption('BTC-PERP');
  await page.locator('#alert-type').selectOption('PRICE_ABOVE');
  await page.locator('#alert-threshold').fill('999999');
  await page.locator('#alert-save').click();
  result.alertCreated = (await page.locator('#alerts-list').textContent()).includes('BTC-PERP');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#workspace-alerts').click();
  result.alertPersisted = (await page.locator('#alerts-list').textContent()).includes('BTC-PERP');
  await page.locator('#alerts-list button').filter({ hasText: 'Delete' }).first().click();
  result.alertDeleted = !(await page.locator('#alerts-list').textContent()).includes('999999');

  await page.locator('#workspace-terminal').click();
  await page.locator('#mode-delegated').click();
  await page.locator('#workspace-journal').click();
  await page.waitForFunction(() => !document.getElementById('journal-load').disabled,
    undefined, { timeout: 60_000 });
  result.journal = await page.locator('#journal-status').textContent();
  result.replayLinked = (await page.locator('#journal-rows').textContent()).includes('14978756187852164141712');
  await page.screenshot({ path: 'docs/screenshots/m9-public-preview-journal.png', fullPage: true });
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  result.mobile = { width: await mobilePage.evaluate(() => document.documentElement.scrollWidth), viewport: 390 };
  await mobilePage.screenshot({ path: 'docs/screenshots/m9-public-preview-mobile.png', fullPage: true });
  await mobile.close();
  assert.equal(result.registry, 21);
  if (result.radar) assert.equal(result.radar.rows, 21);
  assert.ok(result.alertCreated && result.alertPersisted && result.alertDeleted);
  assert.ok(result.staticAssets);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await browser.close(); }
