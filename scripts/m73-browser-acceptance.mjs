/* global fetch, window, document */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.CANARY_LOCAL_URL ?? 'http://127.0.0.1:8787';
const chromePaths = [process.env.CANARY_BROWSER_PATH,
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', chromium.executablePath()].filter(Boolean);
const executablePath = chromePaths.find(existsSync);
assert.ok(executablePath, 'Chromium must be installed');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const operator = '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42';
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0xc4cf';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [operator];
      throw Error(`Read-only acceptance wallet rejected ${method}`);
    },
    on: () => {}, removeListener: () => {},
  };
});
try {
  assert.equal((await fetch(base)).headers.get('content-type')?.startsWith('text/html'), true);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#open-market-selector').waitFor();
  await page.waitForFunction(() => window.__canaryMarkets?.length >= 2, undefined, { timeout: 60000 });
  await page.locator('#book-badge').getByText('TRUSTED').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#candle-status')?.textContent.includes('real fill-derived candles'),
    undefined, { timeout: 60000 });
  const btc = await page.evaluate(() => ({ market: document.querySelector('#market-select').value,
    count: window.__canaryMarkets.length, mark: document.querySelector('#mark').textContent,
    bid: document.querySelector('#book-bid').textContent, ask: document.querySelector('#book-ask').textContent,
    chart: document.querySelector('#candle-status').textContent,
    health: [...document.querySelectorAll('.source-chip')].map(node => node.textContent) }));
  assert.equal(btc.market, 'BTC-PERP');
  assert.ok(Number(btc.mark.replaceAll(',', '')) > 0 && Number(btc.bid.replaceAll(',', '')) > 0);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/m73-terminal-live.png', fullPage: false });
  await page.locator('#open-market-selector').click();
  await page.locator('#market-dialog').waitFor();
  assert.equal(await page.locator('.market-list-row').count(), btc.count);
  await page.screenshot({ path: 'docs/screenshots/m73-market-selector.png', fullPage: false });
  await page.locator('#market-search').fill('ETH');
  await page.locator('.market-row-select[data-symbol="ETH-PERP"]').click();
  await page.waitForFunction(() => document.querySelector('#book-badge')?.textContent === 'TRUSTED' &&
    Number(document.querySelector('#book-bid')?.textContent?.replaceAll(',', '')) > 1000 &&
    Number(document.querySelector('#book-bid')?.textContent?.replaceAll(',', '')) < 10000,
  undefined, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#candle-status')?.textContent.includes('real fill-derived candles'),
    undefined, { timeout: 60000 });
  const eth = await page.evaluate(() => ({ market: document.querySelector('#market-select').value,
    mark: document.querySelector('#mark').textContent, bid: document.querySelector('#book-bid').textContent,
    ask: document.querySelector('#book-ask').textContent, chart: document.querySelector('#candle-status').textContent }));
  assert.equal(eth.market, 'ETH-PERP');
  assert.ok(Number(eth.mark.replaceAll(',', '')) > 0 && Number(eth.bid.replaceAll(',', '')) > 0);
  await page.locator('#wallet-connect').click();
  await page.locator('#mode-delegated').click();
  await page.locator('#open-market-selector').click();
  await page.locator('#market-search').fill('BTC');
  await page.locator('.market-row-select[data-symbol="BTC-PERP"]').click();
  await page.waitForFunction(() => document.querySelector('#wallet-position')?.textContent.includes('BTC') &&
    document.querySelector('#position-intelligence-status')?.textContent.includes('OFFICIAL_SDK_PINNED'),
  undefined, { timeout: 60000 });
  const position = await page.evaluate(() => ({ mode: document.querySelector('#mode-delegated').getAttribute('aria-pressed'),
    account: document.querySelector('#wallet-position').textContent,
    status: document.querySelector('#position-intelligence-status').textContent,
    direction: document.querySelector('#metric-direction').textContent,
    guard: document.querySelector('#guard-decision').textContent }));
  await page.locator('.account-desk').screenshot({ path: 'docs/screenshots/m73-position-intelligence.png' });
  assert.equal(position.mode, 'true');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'LIVE_READ_ONLY', btc, eth, position, pageErrors: errors }, null, 2));
} finally {
  await context.close(); await browser.close();
}
