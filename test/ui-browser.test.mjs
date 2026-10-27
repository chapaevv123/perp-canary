/* global process, fetch, setTimeout, navigator, URL, document, window */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { chromium } from 'playwright-core';

const chromePaths = [
  process.env.CANARY_BROWSER_PATH,
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  chromium.executablePath(),
].filter(Boolean);
let browser, server, base;

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

before(async () => {
  const executablePath = chromePaths.find(existsSync);
  assert.ok(executablePath, 'Chromium, Edge or Chrome must be installed for browser QA');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, CANARY_PORT: String(port) }, stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`${base}/api/v1/health`)).ok; if (ready) break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, 'local server must start');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => { await browser?.close(); server?.kill(); });

function market(block = '34470000', mark = '79800', ageMs = 0) {
  const observedAt = new Date(Date.now() - ageMs).toISOString();
  return { mode: 'LIVE_READ_ONLY', observedAt, block, chainId: 50383, market: 'BTC-PERP', mark,
    book: { status: 'TRUSTED', reasons: [], bid: '79806.1', ask: '79806.3',
      observedAt, block, source: 'SDK_ONCHAIN_PINNED_AND_DIRECT_HTTPS' },
    depth: { status: 'VERIFIED', bids: [{ price: '79806.1', quantity: '0.01' }],
      asks: [{ price: '79806.3', quantity: '0.02' }] },
    bot: { placeGrant: 'SUPPORTED', cancelGrant: 'UNKNOWN', address: '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36' },
    margin: { status: 'NOT_RUN', unlockedUsdso: '999', preview: { status: 'NOT_RUN' } },
    risk: { market: 'SUPPORTED', gas: 'BALANCE_OBSERVED', reasons: [] },
    grid: { tickSizeRaw: '100000000000000000', lotSizeRaw: '1000', minQuantityRaw: '10000' } };
}

const history = { mode: 'LIVE_READ_ONLY', readBlock: '34471000', scanThroughBlock: '34471001',
  position: { sizeBtc: '0.05416', entryPrice: '80043.8', block: '34471000' },
  lifecycle: { state: 'NOT_OPEN_AT_READ', cause: 'UNKNOWN', filledRaw: '0' },
  openOrders: [{ id: '42', side: 'BUY', price: '79800', remaining: '0.0005' }],
  events: [
    { name: 'OrderPlaced', block: '34465778', txHash: '0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121', source: 'VERIFIED_PROOF', quantityRaw: '13000' },
    { name: 'OrderRested', block: '34465778', txHash: '0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121', source: 'VERIFIED_PROOF', quantityRaw: null },
  ] };

async function fixturePage(initScript) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  if (initScript) await page.addInitScript(initScript);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let response = market();
  let delayMs = 0;
  let plan = null;
  await page.route('**/api/v1/terminal/market', async route => {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.fulfill(response?.error ? { status: 503, json: { error: response.error } } : { json: response });
  });
  await page.route('**/api/v1/terminal/history', route => route.fulfill({ json: history }));
  await page.route('**/api/v1/terminal/plan', route => route.fulfill({
    contentType: 'application/json; charset=utf-8', body: JSON.stringify(plan),
  }));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#proof-badge').getByText('VERIFIED').waitFor();
  await page.locator('#book-badge').getByText('TRUSTED', { exact: true }).waitFor();
  return { context, page, errors,
    setMarket: value => { response = value; }, setDelay: value => { delayMs = value; },
    setPlan: value => { plan = value; } };
}

test('real Chromium: controls, exact clipboard commands, chart, risk, proof and error states', async () => {
  const { context, page, errors, setMarket, setDelay, setPlan } = await fixturePage();
  try {
    assert.equal(await page.locator('#buy').isEnabled(), true);
    await page.locator('#buy').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'quantity');
    assert.equal(await page.locator('#sell').isEnabled(), true);
    assert.equal(await page.locator('#order-type').isDisabled(), true);
    assert.equal(await page.locator('#use-ask').isDisabled(), true);
    assert.match(await page.locator('#use-ask').getAttribute('title'), /would cross the book/);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.equal(await page.locator('#position-size').textContent(), '0.05416');
    assert.equal(await page.locator('#order-state').textContent(), 'NOT_OPEN_AT_READ');
    assert.equal(await page.locator('#order-cause').textContent(), 'UNKNOWN');
    assert.match(await page.locator('#timeline').innerText(), /OrderPlaced[\s\S]*OrderRested/);
    assert.match(await page.locator('#proof-events').textContent(), /OrderPlaced \+ OrderRested/);
    assert.equal(await page.locator('#chart-count').textContent(), '1 observed quote');
    assert.match(await page.locator('#chart-empty').textContent(), /First trusted mark/);
    assert.equal(await page.locator('#risk-badge').textContent(), 'AMBER · CLI PREFLIGHT REQUIRED');
    assert.match(await page.locator('#gate-grid').innerText(), /NOT_RUN/);

    await page.locator('#quantity').fill('0.00013');
    await page.locator('#use-bid').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79806.1');
    assert.equal(await page.locator('#copy-prepare').isEnabled(), true);
    assert.match(await page.locator('#prepare-command').textContent(), /BUY 79806\.1 0\.00013/);
    assert.match(await page.locator('#notional').textContent(), /10\.37 USDso/);
    await page.locator('[data-offset="10"]').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79726.2');
    await page.locator('[data-offset="25"]').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79606.5');
    await page.locator('[data-offset="50"]').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79407');
    await page.locator('#copy-prepare').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      'npm.cmd run canary-prepare -- BUY 79407 0.00013');
    assert.match(await page.locator('#copy-feedback').textContent(), /Copied/);
    assert.match(await page.locator('#copy-feedback').getAttribute('class'), /copy-success/);
    await page.locator('#quantity').fill('0.0002');
    assert.match(await page.locator('#prepare-command').textContent(), /BUY 79407 0\.0002/);
    await page.locator('#copy-prepare').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      'npm.cmd run canary-prepare -- BUY 79407 0.0002');
    await page.locator('#quantity').fill('bad');
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.match(await page.locator('#trade-error').textContent(), /Quantity: Enter a positive decimal/);
    await page.locator('#quantity').fill('1');
    assert.match(await page.locator('#trade-error').textContent(), /100 USDso limit/);
    await page.locator('#quantity').fill('0.00013');
    await page.locator('#limit-price').fill('79806.15');
    assert.match(await page.locator('#trade-error').textContent(), /tick grid/);
    await page.locator('#limit-price').fill('79806.3');
    assert.match(await page.locator('#trade-error').textContent(), /cross the opposite book top/);
    await page.locator('#limit-price').fill('79806.1');
    assert.equal(await page.locator('#copy-prepare').isEnabled(), true);
    await page.locator('#sell').click();
    assert.equal(await page.locator('#use-ask').isEnabled(), true);
    await page.locator('#use-ask').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79806.3');
    await page.locator('[data-offset="10"]').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '79886.2');
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    await page.locator('#buy').click();
    await page.locator('#use-bid').click();

    await page.locator('[data-copy="tx"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      '0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121');
    await page.locator('[data-copy="plan"]').click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).length, 64);
    await page.locator('[data-copy="proof"]').click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).length, 64);
    assert.match(await page.locator('#proof-copy-feedback').textContent(), /Copied/);
    assert.equal(await page.locator('#copy-execute').isDisabled(), true);
    assert.equal(await page.locator('#copy-confirmation').isDisabled(), true);
    assert.match(await page.locator('#plan-state').textContent(), /No unexpired saved plan/);
    setPlan({ hash: 'a'.repeat(64), side: 'BUY', price: '79806.1', quantity: '0.00013',
      expiresAt: new Date(Date.now() + 120000).toISOString(), status: 'PREPARED_RECHECK_REQUIRED' });
    await page.locator('#refresh').click();
    await page.locator('#copy-execute').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('copy-execute').disabled);
    await page.locator('#copy-active-plan').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'a'.repeat(64));
    await page.locator('#copy-execute').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      `npm.cmd run bot-execute -- execute ${'a'.repeat(64)}`);
    await page.locator('#copy-confirmation').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `EXECUTE ${'a'.repeat(64)}`);
    setPlan(null);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.getElementById('copy-execute').disabled);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true, value: () => Promise.reject(new Error('clipboard denied')) }));
    await page.locator('[data-copy="tx"]').click();
    assert.match(await page.locator('#proof-copy-feedback').textContent(), /Copy failed/);
    assert.match(await page.locator('#proof-copy-feedback').getAttribute('class'), /copy-failure/);

    setMarket(market('34470001', '79810'));
    await page.locator('#refresh').click();
    await page.locator('#chart-count').getByText('2 observed quotes').waitFor();
    assert.match(await page.locator('#chart-line').getAttribute('d'), /^M.*L/);
    assert.equal(await page.locator('#chart-empty').isHidden(), true);
    assert.notEqual(await page.locator('#chart-y-high').textContent(), '--');
    assert.notEqual(await page.locator('#chart-x-end').textContent(), '--');
    await page.locator('nav a[href="#risk"]').click();
    assert.equal(new URL(page.url()).hash, '#risk');
    await page.locator('nav a[href="#portfolio"]').click();
    assert.equal(new URL(page.url()).hash, '#portfolio');
    await page.locator('nav a[href="#proof"]').click();
    assert.equal(new URL(page.url()).hash, '#proof');
    await page.locator('nav a[href="#market"]').click();
    assert.equal(new URL(page.url()).hash, '#market');

    setDelay(500);
    const refresh = page.locator('#refresh');
    await refresh.click();
    assert.equal(await refresh.isDisabled(), true);
    assert.match(await refresh.textContent(), /Refreshing/);
    await refresh.getByText('Refresh live data').waitFor();
    setDelay(0);
    setMarket(market('34470002', '79810', 40000));
    await refresh.click();
    await page.locator('#book-badge').getByText('STALE').waitFor();
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.match(await page.locator('#risk-badge').textContent(), /STALE/);
    setMarket({ error: 'RPC fixture unavailable' });
    await refresh.click();
    await page.locator('#rpc-pill').getByText('RPC · UNKNOWN').waitFor();
    assert.match(await page.locator('#chart-source').textContent(), /Source error/);
    assert.equal(await page.locator('#mark').textContent(), '—');
    assert.ok(errors.some(error => error.includes('503')), 'expected network failure is visible in console');
    assert.deepEqual(errors.filter(error => !error.includes('503')), []);
  } finally { await context.close(); }
});

test('real Chromium: wallet review, rejection, guarded submission and mocked receipt', async () => {
  const account = '0x1111111111111111111111111111111111111111';
  const txHash = `0x${'a'.repeat(64)}`;
  const { context, page, errors } = await fixturePage(() => {
    const wallet = '0x1111111111111111111111111111111111111111';
    const hash = `0x${'a'.repeat(64)}`;
    const listeners = {};
    window.__walletMock = { chain: '0xc4cf', account: wallet, sends: 0, reject: false,
      changeAccount(value) { this.account = value; listeners.accountsChanged?.([value]); },
      changeChain(value) { this.chain = value; listeners.chainChanged?.(value); } };
    window.ethereum = {
      on(name, callback) { listeners[name] = callback; },
      removeListener(name) { delete listeners[name]; },
      async request({ method }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__walletMock.account];
        if (method === 'eth_chainId') return window.__walletMock.chain;
        if (method === 'wallet_switchEthereumChain') { window.__walletMock.changeChain('0xc4cf'); return null; }
        if (method === 'eth_sendTransaction') {
          window.__walletMock.sends++;
          if (window.__walletMock.reject) throw Error('User rejected request');
          return hash;
        }
        throw Error(`Unexpected wallet method ${method}`);
      },
    };
  });
  let prepareStatus = 'READY', receiptState = 'PENDING', prepareCalls = 0;
  const tx = { chainId: 50383, from: account, to: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0',
    data: '0x4e978373', value: '0x0', gas: '0x5208', expiresAt: new Date(Date.now() + 280000).toISOString(),
    maxGasCostStt: '0.001' };
  try {
    await page.route('**/api/v1/trade/account?**', route => route.fulfill({ json: { account, gasStt: '1',
      walletUsdso: '100', marginUnlocked: '50', position: { sizeBtc: '0', entryPrice: '0' },
      openOrders: [], block: '123' } }));
    await page.route('**/api/v1/trade/prepare', route => {
      prepareCalls++;
      route.fulfill({ json: { status: prepareStatus, guard: { verdict: prepareStatus === 'READY' ? 'GREEN' : 'RED',
        blockers: prepareStatus === 'READY' ? [] : ['Contract simulation failed.'], warnings: [],
        notionalRaw: '10374793000000000000' }, transaction: prepareStatus === 'READY' ? tx : null } });
    });
    await page.route('**/api/v1/trade/receipt?**', route => route.fulfill({ json: {
      state: receiptState, hash: txHash, block: '456', orderId: '789' } }));
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    await page.locator('#wallet-connect').click();
    await page.locator('#wallet-state').getByText(/Hideki 50383/).waitFor();
    await page.locator('#quantity').fill('0.00013');
    await page.locator('#use-bid').click();
    prepareStatus = 'BLOCKED';
    await page.locator('#review-order').click();
    await page.locator('#guard-verdict').getByText('RED').waitFor();
    assert.equal(await page.locator('#trade-review').isHidden(), true);
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 0);
    prepareStatus = 'READY';
    await page.locator('#review-order').click();
    await page.locator('#trade-review').waitFor();
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/m5-wallet-review-mocked.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'test-results/m5-wallet-review-mobile-mocked.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 0);
    await page.evaluate(() => { window.__walletMock.reject = true; });
    await page.locator('#confirm-wallet').click();
    await page.locator('#wallet-result').getByText(/User rejected request/).waitFor();
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 1);
    await page.locator('#review-order').click();
    await page.evaluate(() => { window.__walletMock.reject = false; });
    receiptState = 'PLACED';
    await page.locator('#confirm-wallet').click();
    await page.locator('#wallet-result').getByText(/On-chain placement confirmed/).waitFor();
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 2);
    assert.ok(prepareCalls >= 4);
    await page.evaluate(() => window.__walletMock.changeChain('0x1'));
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    await page.locator('#wallet-switch').click();
    await page.locator('#wallet-state').getByText(/Hideki 50383/).waitFor();
    await page.evaluate(() => window.__walletMock.changeAccount('0x2222222222222222222222222222222222222222'));
    await page.locator('#wallet-state').getByText(/0x2222/).waitFor();
    await page.locator('#wallet-disconnect').click();
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: missing injected wallet cannot review or submit', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    await page.locator('#wallet-connect').click();
    assert.match(await page.locator('#wallet-result').textContent(), /No injected EIP-1193 wallet/);
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: wide and responsive layout, typography and panel geometry', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    mkdirSync('test-results', { recursive: true });
    for (const [width, height] of [[2560, 1440], [1920, 1080], [1600, 900], [1440, 900],
      [1366, 768], [1280, 800], [768, 1024], [390, 844], [320, 720]]) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const [brand, nav, status] = ['.brand', '.topbar nav', '.top-status'].map(rect);
        const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const font = selector => parseFloat(window.getComputedStyle(document.querySelector(selector)).fontSize);
        const shell = rect('.shell'), chart = rect('.chart-panel'), book = rect('.book-panel');
        const trade = rect('.trade-panel'), risk = rect('.risk-panel'), portfolio = rect('.portfolio-panel');
        const proof = rect('.proof-panel');
        return { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
          overflowNodes: [...document.querySelectorAll('body *')].filter(node =>
            node.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map(node =>
            `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.split(' ')[0]}` : ''}`),
          brandNav: intersects(brand, nav), brandStatus: intersects(brand, status), navStatus: intersects(nav, status),
          brandVisible: brand.width > 100 && brand.height > 20,
          shell: shell.width, shellLeft: shell.left, headerLeft: brand.left,
          fonts: { body: font('body'), secondary: font('.small'), button: font('.button'),
            input: font('.field input'), price: font('.metric strong'), heading: font('.panel-head h2') },
          chart: { x: chart.x, y: chart.y, width: chart.width },
          book: { x: book.x, y: book.y, width: book.width },
          trade: { x: trade.x, y: trade.y, width: trade.width },
          risk: { x: risk.x, y: risk.y }, portfolio: { x: portfolio.x, y: portfolio.y },
          proof: { x: proof.x, y: proof.y },
          tableFits: document.querySelector('.table-wrap').scrollWidth <=
            document.querySelector('.table-wrap').clientWidth,
          proofFits: document.querySelector('.proof-panel').scrollWidth <= proof.width + 1,
        };
      });
      assert.equal(layout.scrollWidth <= layout.width, true, `horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.brandNav || layout.brandStatus || layout.navStatus, false, `header overlap at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.brandVisible, true);
      assert.ok(width >= 550 ? layout.shell >= width * .94 && layout.shell <= width * .96 :
        layout.shell >= width - 30 && layout.shell <= width - 26,
        `shell width at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.fonts.body >= 15 && layout.fonts.secondary >= 12 && layout.fonts.button >= 14 &&
        layout.fonts.input >= 15 && layout.fonts.price >= 22 && layout.fonts.heading >= 17,
      `typography at ${width}: ${JSON.stringify(layout.fonts)}`);
      assert.ok(layout.chart.width > (width < 550 ? 250 : 300) &&
        layout.book.width > (width < 550 ? 250 : 300) && layout.trade.width > (width < 550 ? 250 : 300),
        `panel width at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.tableFits && layout.proofFits, true, `table or hash overflow at ${width}: ${JSON.stringify(layout)}`);
      if (width >= 1600) {
        assert.ok(layout.chart.x < layout.book.x && layout.book.x < layout.trade.x &&
          Math.abs(layout.chart.y - layout.book.y) < 2 && Math.abs(layout.book.y - layout.trade.y) < 2,
        `desktop panel order at ${width}: ${JSON.stringify(layout)}`);
      } else if (width >= 901) {
        assert.ok(layout.chart.x < layout.book.x && layout.risk.x < layout.trade.x &&
          layout.portfolio.x < layout.proof.x, `laptop panel order at ${width}: ${JSON.stringify(layout)}`);
      } else {
        assert.ok(layout.chart.y < layout.book.y && layout.book.y < layout.trade.y &&
          layout.trade.y < layout.risk.y && layout.risk.y < layout.portfolio.y &&
          layout.portfolio.y < layout.proof.y, `tablet panel order at ${width}: ${JSON.stringify(layout)}`);
      }
      if (width === 1920 || width === 2560 || width === 390 || width === 320)
        await page.screenshot({ path: `test-results/ui-qa-${width}.png`, fullPage: true });
      if (width === 1920)
        await page.locator('.topbar').screenshot({ path: 'test-results/ui-qa-header-1920.png' });
      if (width === 1920 || width === 2560) process.stdout.write(`QA layout ${JSON.stringify(layout)}\n`);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: original Canary SVG serves as logo and favicon at five sizes', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    const icon = await page.request.get(`${base}/canary-mark.svg`);
    assert.equal(icon.status(), 200);
    assert.match(icon.headers()['content-type'], /image\/svg\+xml/);
    assert.match(await icon.text(), /<svg[\s\S]*<path/);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/canary-mark.svg');
    assert.equal(await page.locator('.brandmark').evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.doesNotMatch(await page.locator('.brand').innerText(), /\bPB\b/);
    await page.evaluate(async () => {
      const sample = document.createElement('div');
      sample.id = 'logo-size-samples';
      sample.style.cssText = 'display:flex;align-items:center;gap:24px;padding:24px;background:#151922;width:max-content';
      for (const size of [16, 24, 32, 48, 128]) {
        const image = document.createElement('img');
        image.src = '/canary-mark.svg'; image.width = size; image.height = size;
        image.alt = `Canary mark ${size}px`; sample.append(image);
      }
      document.body.append(sample);
      await Promise.all([...sample.querySelectorAll('img')].map(image => image.decode()));
    });
    await page.locator('#logo-size-samples').screenshot({ path: 'test-results/ui-qa-logo-sizes.png' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: stale first read leaves the chart empty and preview blocked', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/terminal/market', route => route.fulfill({ json: market('34470000', '79800', 40000) }));
  await page.route('**/api/v1/terminal/history', route => route.fulfill({ json: history }));
  await page.route('**/api/v1/terminal/plan', route => route.fulfill({
    contentType: 'application/json; charset=utf-8', body: 'null',
  }));
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#book-badge').getByText('STALE').waitFor();
    assert.equal(await page.locator('#chart-count').textContent(), '0 observed quotes');
    assert.equal(await page.locator('#chart-line').getAttribute('d'), '');
    assert.equal(await page.locator('#chart-empty').isVisible(), true);
    assert.match(await page.locator('#risk-badge').textContent(), /STALE/);
    assert.equal(await page.locator('#use-bid').isDisabled(), true);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: legacy page serves readable UTF-8 and navigation works', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${base}/legacy`, { waitUntil: 'domcontentloaded' });
    assert.match(response.headers()['content-type'], /text\/html; charset=utf-8/);
    assert.match(await page.title(), /Perp Canary/);
    assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
    assert.equal(await page.locator('body').count(), 1);
    assert.equal(await page.locator('body').innerText().then(text => /[\u0400-\u04ff\ufffd]/.test(text)), false);
    assert.equal((await page.goto(base)).status(), 200);
    assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
  } finally { await context.close(); }
});

test('real Chromium: live RPC smoke', { skip: process.env.CANARY_UI_LIVE !== '1' }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#proof-badge').getByText('VERIFIED').waitFor({ timeout: 15000 });
    await page.locator('#book-badge').getByText('TRUSTED', { exact: true }).waitFor({ timeout: 90000 });
    await page.locator('#order-state').getByText('NOT_OPEN_AT_READ').waitFor({ timeout: 90000 });
    assert.equal(await page.locator('#order-cause').textContent(), 'UNKNOWN');
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.getElementById('chart-line').getAttribute('d').includes('L'),
      undefined, { timeout: 90000 });
    await page.waitForFunction(() => !document.getElementById('refresh').disabled &&
      !document.getElementById('position-block').textContent.includes('REFRESHING'),
    undefined, { timeout: 90000 });
    assert.match(await page.locator('#chart-count').textContent(), /[2-9] observed quotes/);
    assert.deepEqual(errors, []);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/ui-qa-live.png', fullPage: true });
  } finally { await context.close(); }
});
