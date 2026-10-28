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
let serverStderr = '';

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
    cwd: process.cwd(), env: { ...process.env, CANARY_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverStderr += String(chunk).slice(0, 2000); });
  server.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM')
      process.stderr.write(`UI server exited: code=${code} signal=${signal} ${serverStderr}\n`);
  });
  let ready = false;
  for (let i = 0; i < 200; i++) {
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
  await page.route('**/api/v1/terminal/account', route => route.fulfill({ json: {
    readBlock: history.readBlock, position: history.position, openOrders: history.openOrders } }));
  await page.route('**/api/v1/markets', route => route.fulfill({ json: { observedAt: new Date().toISOString(),
    markets: [
      { id: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0', symbol: 'BTC-PERP',
        marketType: 'PERP', base: 'BTC', quote: 'USDso', status: 'TRADEABLE',
        lastIndexedPrice: '79800', openInterestBase: '3.2', fundingRateWindowPercent: null, maxLeverage: '20' },
      { id: '0xd6cb1dd58580b84d76068ac21594219ce03aeddf', symbol: 'ETH-PERP',
        marketType: 'PERP', base: 'ETH', quote: 'USDso', status: 'TRADEABLE',
        lastIndexedPrice: '2346.15', openInterestBase: null, fundingRateWindowPercent: null, maxLeverage: '20' },
    ] } }));
  await page.route('**/api/v1/markets/snapshot?**', async route => {
    if (new URL(route.request().url()).searchParams.get('market') === 'BTC-PERP') {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      await route.fulfill(response?.error ? { status: 503, json: { error: response.error } } : { json: response });
      return;
    }
    const eth = market('34470001', '2346.15');
    eth.market = 'ETH-PERP'; eth.book.bid = '2346.40'; eth.book.ask = '2346.50';
    eth.depth.bids = [{ price: '2346.40', quantity: '1.2' }];
    eth.depth.asks = [{ price: '2346.50', quantity: '0.8' }];
    eth.grid = { tickSizeRaw: '10000000000000000', lotSizeRaw: '100000000000000',
      minQuantityRaw: '4000000000000000', baseDecimals: 18, quoteDecimals: 18 };
    eth.marketMeta = { base: 'ETH', quote: 'USDso' };
    eth.bot.placeGrant = 'NOT_APPLICABLE';
    route.fulfill({ json: eth });
  });
  await page.route('**/api/v1/markets/candles?**', route => route.fulfill({ json: {
    status: 'UNAVAILABLE', reason: 'MOCKED fixture has no historical candles',
    source: 'MOCKED', observedAt: new Date().toISOString(), candles: [] } }));
  await page.route('**/api/v1/markets/trades?**', route => route.fulfill({ json: {
    status: 'UNAVAILABLE', source: 'MOCKED', observedAt: new Date().toISOString(), trades: [] } }));
  await page.route('**/api/v1/health/sources?**', route => route.fulfill({ json: {
    market: new URL(route.request().url()).searchParams.get('market'),
    rpc: { status: 'HEALTHY', detail: 'MOCKED RPC' },
    websocket: { status: 'HEALTHY', detail: 'MOCKED WebSocket' },
    indexer: { status: 'HEALTHY', detail: 'MOCKED indexer' },
    pool: { status: 'HEALTHY', detail: 'MOCKED pool' } } }));
  await page.route('**/api/v1/position/intelligence?**', route => route.fulfill({ json: {
    source: 'MOCKED', block: '123', observedAt: new Date().toISOString(),
    availableMarginUsdso: '50', direction: 'FLAT', size: '0', entryPrice: null,
    markPrice: null, unrealizedPnlUsdso: null, accruedFundingOwedUsdso: null,
    liquidationPrice: null, liquidationReason: 'No position', realizedPnlReason: 'Unavailable in fixture',
    metricsReason: 'No position', scenarioInputs: null } }));
  await page.route('**/api/v1/terminal/plan', route => route.fulfill({
    contentType: 'application/json; charset=utf-8', body: JSON.stringify(plan),
  }));
  await page.route('**/api/v1/wallet/identity?**', route => route.fulfill({ json: {
    account: new URL(route.request().url()).searchParams.get('account') } }));
  await page.route('**/api/v1/wallet/funding?**', route => route.fulfill({ json: {
    account: new URL(route.request().url()).searchParams.get('account'), chainId: 50383,
    block: '123', nativeStt: '1', nativeSttWei: '1000000000000000000',
    walletUsdso: '100', marginFreeUsdso: '50', marginWithdrawableUsdso: '10',
    voucher: { claimed: true, floorUsdso: '0' }, btcVoucherAllowed: true,
    eligibility: { eligible: false, reason: 'alreadyClaimed' } } }));
  await page.route('**/api/v1/wallet/embedded-ownership', route => route.fulfill({ json: {
    account: '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f',
    threshold: '1', metaMaskIsOwner: false } }));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#historical-tools').click();
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
    assert.equal(await page.locator('#order-type').textContent(), 'PostOnly (supported)');
    assert.equal(await page.locator('#use-ask').isDisabled(), true);
    assert.match(await page.locator('#use-ask').getAttribute('title'), /would cross the spread/);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.equal(await page.locator('#position-size').textContent(), '0.05416');
    assert.equal(await page.locator('#order-state').textContent(), 'NOT_OPEN_AT_READ');
    assert.equal(await page.locator('#order-cause').textContent(), 'UNKNOWN');
    assert.match(await page.locator('#timeline').innerText(), /OrderPlaced[\s\S]*OrderRested/);
    assert.match(await page.locator('#proof-events').textContent(), /OrderPlaced \+ OrderRested/);
    assert.equal(await page.locator('#chart-count').textContent(), '1 observed quote');
    assert.match(await page.locator('#chart-empty').textContent(), /trace appears after 8 distinct blocks/);
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
    assert.match(await page.locator('#notional').textContent(), /79,407\.00 USDso/);
    assert.match(await page.locator('#trade-error').textContent(), /Input preview only/);
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
    assert.equal(await page.locator('#chart-empty').isHidden(), false);
    for (let index = 2; index < 8; index++) {
      setMarket(market(String(34470000 + index), String(79800 + index * 10)));
      await page.locator('#refresh').click();
      await page.locator('#chart-count').getByText(`${index + 1} observed quotes`).waitFor();
    }
    await page.locator('#chart-count').getByText('8 observed quotes').waitFor();
    assert.match(await page.locator('#chart-line').getAttribute('d'), /^M.*L/);
    assert.equal(await page.locator('#chart-empty').isHidden(), true);
    assert.notEqual(await page.locator('#chart-y-high').textContent(), '--');
    assert.notEqual(await page.locator('#chart-x-end').textContent(), '--');
    await page.evaluate(() => { window.location.hash = '#risk'; });
    assert.equal(new URL(page.url()).hash, '#risk');
    await page.evaluate(() => { window.location.hash = '#portfolio'; });
    assert.equal(new URL(page.url()).hash, '#portfolio');
    await page.evaluate(() => { window.location.hash = '#proof'; });
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
    await page.waitForFunction(() => document.getElementById('rpc-pill').textContent.includes('UNKNOWN'));
    assert.match(await page.locator('#chart-source').textContent(), /Source error/);
    assert.equal(await page.locator('#mark').textContent(), '—');
    assert.ok(errors.some(error => error.includes('503')), 'expected network failure is visible in console');
    assert.deepEqual(errors.filter(error => !error.includes('503')), []);
  } finally { await context.close(); }
});

test('real Chromium: M7 unavailable history and verified execution replay', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    await page.locator('#candle-status').getByText(/History unavailable/).waitFor();
    assert.equal(await page.locator('#candle-canvas').isHidden(), true);
    await page.locator('.replay-trigger').click();
    await page.locator('#replay-steps').getByText(/OrderFilled/).waitFor();
    assert.match(await page.locator('#replay-steps').innerText(), /NOT_RECORDED_FOR_THIS_ORDER/);
    assert.match(await page.locator('#replay-steps').innerText(), /0\.05416.*0\.05429/);
    mkdirSync('test-results', { recursive: true });
    await page.locator('.execution-replay').screenshot({ path: 'test-results/m73-replay-mocked-ui.png' });
    await page.locator('#replay-close').click();
    await page.screenshot({ path: 'test-results/m73-terminal-mocked-ui.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: wallet review, rejection, guarded submission and mocked receipt', async () => {
  const account = '0x1111111111111111111111111111111111111111';
  const txHash = `0x${'a'.repeat(64)}`;
  const { context, page, errors, setMarket } = await fixturePage(() => {
    const wallet = '0x1111111111111111111111111111111111111111';
    const hash = `0x${'a'.repeat(64)}`;
    const listeners = {};
    window.__walletMock = { chain: '0xc4cf', account: wallet, sends: 0, reject: false, lastTx: null,
      changeAccount(value) { this.account = value; listeners.accountsChanged?.([value]); },
      changeChain(value) { this.chain = value; listeners.chainChanged?.(value); } };
    window.ethereum = {
      on(name, callback) { listeners[name] = callback; },
      removeListener(name) { delete listeners[name]; },
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__walletMock.account];
        if (method === 'eth_chainId') return window.__walletMock.chain;
        if (method === 'wallet_switchEthereumChain') { window.__walletMock.changeChain('0xc4cf'); return null; }
        if (method === 'eth_sendTransaction') {
          window.__walletMock.sends++;
          window.__walletMock.lastTx = params[0];
          if (window.__walletMock.reject) throw Error('User rejected request');
          return hash;
        }
        throw Error(`Unexpected wallet method ${method}`);
      },
    };
  });
  let prepareStatus = 'READY', receiptState = 'PENDING', prepareCalls = 0;
  const tx = { chainId: 50383, from: account, to: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0',
    data: '0x4e978373', value: '0x0', gas: '0x5208', nonce: 0,
    expiresAt: new Date(Date.now() + 280000).toISOString(),
    maxGasCostStt: '0.001' };
  try {
    await page.route('**/api/v1/trade/account?**', route => route.fulfill({ json: { account, gasStt: '1',
      walletUsdso: '100', allowance: '0', marginUnlocked: '50', withdrawable: '10',
      position: { sizeBtc: '0', entryPrice: '0' },
      openOrders: [{ id: '789', side: 'BUY', remaining: '0.00013', price: '79806.1' }], block: '123' } }));
    await page.route('**/api/v1/trade/prepare', route => {
      prepareCalls++;
      route.fulfill({ json: { status: prepareStatus, guard: { verdict: prepareStatus === 'READY' ? 'GREEN' : 'RED',
        blockers: prepareStatus === 'READY' ? [] : ['Contract simulation failed.'], warnings: [],
        notionalRaw: '10374793000000000000' },
      observation: { chainId: 50383, observedAt: new Date().toISOString(), block: '123',
        account: { address: account }, book: { status: 'TRUSTED', bid: '79806.1', ask: '79806.3', block: '123' } },
      marginPreview: { sufficient: true, lockUsdso: '10', asOfBlock: '123' },
      transaction: prepareStatus === 'READY' ? tx : null } });
    });
    await page.route('**/api/v1/trade/receipt?**', route => route.fulfill({ json: {
      state: receiptState, hash: txHash, block: '456', orderId: '789' } }));
    await page.route('**/api/v1/trade/action/prepare', route => route.fulfill({ json: {
      status: 'READY', action: route.request().postDataJSON().action,
      allowance: '0', walletUsdso: '100', withdrawable: '10',
      transaction: { ...tx, to: '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72',
        data: '0x095ea7b3' } } }));
    await page.route('**/api/v1/trade/action/receipt?**', route => route.fulfill({ json: {
      state: 'CONFIRMED', hash: txHash, block: '457' } }));
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    await page.locator('#wallet-connect').click();
    await page.locator('#wallet-state').getByText(/Hideki 50383/).waitFor();
    assert.match(await page.locator('#wallet-identity').textContent(), /0x1111/);
    await page.locator('#wallet-identity').click();
    await page.locator('#wallet-full-address').getByText(account).waitFor();
    await page.locator('#wallet-identity-warning').getByText(/ACCOUNT MISMATCH/).waitFor();
    assert.match(await page.locator('#wallet-native-stt').textContent(), /1 STT/);
    await page.locator('#wallet-details-close').click();
    await page.locator('#quantity').fill('0.00013');
    await page.locator('#use-bid').click();
    assert.equal(await page.locator('#guard-decision').textContent(), 'READY FOR REVIEW');
    assert.equal(await page.locator('#confirm-wallet').isDisabled(), true);
    assert.equal(await page.locator('#use-ask').isDisabled(), true);
    prepareStatus = 'BLOCKED';
    await page.locator('#review-order').click();
    await page.locator('#guard-verdict').getByText('RED').waitFor();
    assert.equal(await page.locator('#guard-decision').textContent(), 'BLOCKED');
    assert.equal(await page.locator('#trade-review').isHidden(), true);
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 0);
    prepareStatus = 'READY';
    await page.locator('#review-order').click();
    await page.locator('#trade-review').waitFor();
    assert.equal(await page.locator('#guard-decision').textContent(), 'SAFE');
    mkdirSync('docs/screenshots', { recursive: true });
    await page.locator('.trade-panel').screenshot({ path: 'test-results/m74-trade-ticket.png' });
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
    assert.match(await page.locator('#trade-review-summary').textContent(), /Order #789/);
    assert.match(await page.locator('#trade-review-summary').textContent(), /Current fill and PnL require separate on-chain evidence/);
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 2);
    assert.equal(await page.evaluate(() => window.__walletMock.lastTx.nonce), '0x0');
    assert.ok(prepareCalls >= 4);
    await page.locator('#account-tab-button-balances').click();
    await page.locator('#action-amount').fill('10');
    await page.locator('#review-action').click();
    await page.locator('#action-review').waitFor();
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 2);
    await page.locator('#confirm-action').click();
    await page.locator('#action-result').getByText(/APPROVE CONFIRMED/).waitFor();
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 3);
    await page.locator('#account-tab-button-orders').click();
    await page.locator('.wallet-order-row button').click();
    assert.equal(await page.locator('#wallet-action').inputValue(), 'CANCEL');
    assert.equal(await page.locator('#action-order-id').inputValue(), '789');
    await page.locator('#review-action').click();
    await page.locator('#action-review').waitFor();
    await page.locator('#dismiss-action').click();
    assert.equal(await page.evaluate(() => window.__walletMock.sends), 3);
    await page.evaluate(() => window.__walletMock.changeChain('0x1'));
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    await page.locator('#wallet-switch').click();
    await page.locator('#wallet-state').getByText(/Hideki 50383/).waitFor();
    await page.evaluate(() => window.__walletMock.changeAccount('0x2222222222222222222222222222222222222222'));
    await page.locator('#wallet-state').getByText(/0x2222/).waitFor();
    setMarket({ error: 'read-only market transport unavailable' });
    await page.locator('#refresh').click();
    await page.locator('#book-badge').getByText('UNTRUSTED').waitFor();
    assert.equal(await page.locator('#guard-decision').textContent(), 'UNAVAILABLE');
    await page.locator('#wallet-disconnect').click();
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    assert.deepEqual(errors.filter(message => !message.includes('503 (Service Unavailable)')), []);
  } finally { await context.close(); }
});

test('real Chromium: missing injected wallet cannot review or submit', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    assert.equal(await page.locator('#guard-decision').textContent(), 'NOT READY');
    await page.locator('#historical-tools').click();
    assert.equal(await page.locator('#risk').isHidden(), true);
    await page.locator('#nav-funding').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'wallet-connect');
    await page.locator('#wallet-connect').click();
    assert.match(await page.locator('#wallet-result').textContent(), /No injected EIP-1193 wallet/);
    assert.equal(await page.locator('#review-order').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: custom maximum persists per wallet and mode without changing quantity', async () => {
  const account = '0x1111111111111111111111111111111111111111';
  const { context, page, errors } = await fixturePage(() => {
    window.__testWallet = { account: '0x1111111111111111111111111111111111111111', sends: 0 };
    window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [window.__testWallet.account];
      if (method === 'eth_chainId') return '0xc4cf';
      if (method === 'eth_sendTransaction') { window.__testWallet.sends++; throw Error('Unexpected wallet send'); }
      throw Error(`Unexpected wallet method ${method}`);
    } };
  });
  let reviewedLimit = null;
  try {
    await page.route('**/api/v1/trade/account?**', route => route.fulfill({ json: {
      account, market: 'BTC-PERP', block: '123', gasStt: '1', marginUnlocked: '10000',
      walletUsdso: '10000', allowance: '0', withdrawable: '10000',
      position: { size: '0', entryPrice: '0' }, openOrders: [] } }));
    await page.route('**/api/v1/trade/prepare', route => {
      reviewedLimit = JSON.parse(route.request().postData()).customMaxNotional;
      route.fulfill({ json: { status: 'BLOCKED', guard: { verdict: 'RED', blockers: ['Mocked margin unavailable'], warnings: [] },
        observation: { chainId: 50383, account: { address: account }, book: { status: 'TRUSTED' } }, transaction: null } });
    });
    await page.locator('#wallet-connect').click();
    await page.locator('#wallet-permission-details').evaluate(node => { node.open = true; });
    assert.match(await page.locator('#custom-limit-status').textContent(), /No custom maximum/);
    await page.locator('#quantity').fill('0.01253');
    await page.locator('#use-bid').click();
    assert.match(await page.locator('#trade-error').textContent(), /Input preview only/);
    await page.locator('#custom-limit-enabled').check();
    await page.locator('#custom-limit-amount').fill('500');
    assert.match(await page.locator('#trade-error').textContent(), /custom 500 USDso maximum/);
    assert.equal(await page.locator('#quantity').inputValue(), '0.01253');
    await page.locator('#custom-limit-amount').fill('2000');
    await page.locator('#review-order').click();
    assert.equal(reviewedLimit, '2000');
    assert.equal(await page.evaluate(() => window.__testWallet.sends), 0);
    await page.locator('#custom-limit-amount').fill('500');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#wallet-connect').click();
    await page.locator('#wallet-permission-details').evaluate(node => { node.open = true; });
    assert.equal(await page.locator('#custom-limit-enabled').isChecked(), true);
    assert.equal(await page.locator('#custom-limit-amount').inputValue(), '500');
    await page.locator('#mode-delegated').click();
    assert.equal(await page.locator('#custom-limit-enabled').isChecked(), false);
    await page.locator('#mode-direct').click();
    assert.equal(await page.locator('#custom-limit-amount').inputValue(), '500');
    assert.equal(await page.evaluate(() => window.__testWallet.sends), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: position sizing applies exact market quantity and clears on market change', async () => {
  const { context, page, errors } = await fixturePage();
  const requests = [];
  try {
    await page.route('**/api/v1/intelligence/size', route => {
      const draft = JSON.parse(route.request().postData()); requests.push(draft);
      route.fulfill({ json: { confidence: 'ESTIMATED', status: 'CALCULATED',
        quantity: draft.market === 'BTC-PERP' ? '0.00124' : '0.02',
        riskBudgetUsdso: '1', notionalUsdso: '98.959564', initialMarginUsdso: '4.9479782',
        invalidationDistancePercent: '1.01', lossAtStopUsdso: '0.999564',
        assumptions: 'Stop is a reference only, not an installed order.' } });
    });
    await page.locator('#workspace-plan').click();
    await page.locator('#limit-price').fill('79806.1');
    await page.locator('#size-capital').fill('100');
    await page.locator('#size-risk').fill('1');
    await page.locator('#size-stop').fill('79000');
    await page.locator('#calculate-size').click();
    await page.locator('#size-result').getByText(/0\.00124 BTC/).waitFor();
    assert.match(await page.locator('#size-result').textContent(), /0\.00124 BTC.*not an installed order/);
    await page.locator('#use-sized-quantity').click();
    assert.equal(await page.locator('#quantity').inputValue(), '0.00124');
    assert.equal(requests[0].market, 'BTC-PERP');
    await page.locator('#market-select').selectOption('ETH-PERP');
    await page.locator('#book-badge').getByText('TRUSTED').waitFor();
    assert.equal(await page.locator('#quantity').inputValue(), '');
    assert.equal(await page.locator('#use-sized-quantity').isDisabled(), true);
    await page.locator('#limit-price').fill('2346.4');
    await page.locator('#size-stop').fill('2300');
    await page.locator('#calculate-size').click();
    await page.locator('#size-result').getByText(/0\.02 ETH/).waitFor();
    assert.match(await page.locator('#size-result').textContent(), /0\.02 ETH/);
    await page.locator('#use-sized-quantity').click();
    assert.equal(await page.locator('#quantity').inputValue(), '0.02');
    assert.equal(requests[1].market, 'ETH-PERP');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: funding identity, no gas, voucher review and rejected signature', async () => {
  const account = '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42';
  const { context, page, errors } = await fixturePage(() => {
    const listeners = {};
    window.__fundingWallet = { account: '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42',
      chain: '0xc4cf', sends: 0, reject: true, lastTx: null };
    window.ethereum = { isMetaMask: true,
      on(name, callback) { listeners[name] = callback; },
      removeListener(name) { delete listeners[name]; },
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__fundingWallet.account];
        if (method === 'eth_chainId') return window.__fundingWallet.chain;
        if (method === 'eth_sendTransaction') { window.__fundingWallet.sends++;
          window.__fundingWallet.lastTx = params[0];
          if (window.__fundingWallet.reject) throw Error('User rejected request');
          return `0x${'b'.repeat(64)}`; }
        throw Error(`Unexpected wallet method ${method}`);
      },
    };
  });
  let gas = '0', eligible = true;
  const tx = { chainId: 50383, from: account, to: '0x2ACD9EFdA721450906bfE1bef3edE269636E42C4',
    data: '0x4e71d92d', value: '0x0', gas: '0x100000', nonce: 0, maxGasCostStt: '0.003' };
  try {
    await page.route('**/api/v1/wallet/funding?**', route => route.fulfill({ json: {
      account, chainId: 50383, block: '123', nativeStt: gas,
      nativeSttWei: gas === '0' ? '0' : '1000000000000000000', walletUsdso: '0',
      marginFreeUsdso: '0', marginWithdrawableUsdso: '0', voucher: { claimed: false, floorUsdso: '0' },
      btcVoucherAllowed: true, eligibility: eligible ? { eligible: true, grantUsdso: '1000' } :
        { eligible: false, reason: 'alreadyClaimed' } } }));
    await page.route('**/api/v1/trade/account?**', route => route.fulfill({ json: {
      account, market: 'BTC-PERP', block: '123', gasStt: gas, walletUsdso: '0',
      allowance: '0', marginUnlocked: '0', withdrawable: '0',
      position: { size: '0', entryPrice: '0' }, openOrders: [] } }));
    await page.route('**/api/v1/wallet/voucher/prepare', route => route.fulfill({ json: {
      status: 'READY_FOR_OWNER_CONFIRMATION', account, grantUsdso: '1000', transaction: tx } }));
    await page.locator('#wallet-connect').click();
    await page.locator('#wallet-identity').click();
    await page.locator('#wallet-native-stt').getByText('0 STT').waitFor();
    assert.match(await page.locator('#wallet-identity-warning').textContent(), /External MetaMask EOA/);
    assert.match(await page.locator('#funding-remediation').textContent(), /Link a Bot/);
    assert.equal(await page.locator('#review-voucher').isDisabled(), true);
    eligible = false; gas = '1'; await page.locator('#check-voucher').click();
    await page.locator('#voucher-eligibility').getByText(/INELIGIBLE/).waitFor();
    assert.equal(await page.locator('#review-voucher').isDisabled(), true);
    eligible = true; await page.locator('#check-voucher').click();
    await page.locator('#voucher-eligibility').getByText(/ELIGIBLE/).waitFor();
    await page.locator('#review-voucher').click();
    await page.locator('#voucher-result').getByText(/READY_FOR_OWNER_CONFIRMATION/).waitFor();
    assert.equal(await page.evaluate(() => window.__fundingWallet.sends), 0);
    assert.match(await page.locator('#voucher-review-details').textContent(), /nonwithdrawable paper USDso/);
    await page.locator('#confirm-voucher').click();
    await page.locator('#voucher-result').getByText(/User rejected request/).waitFor();
    assert.equal(await page.evaluate(() => window.__fundingWallet.sends), 1);
    assert.equal(await page.evaluate(() => window.__fundingWallet.lastTx.nonce), '0x0');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: delegated Wallet 1 grant, owner margin, review and cancel readiness', async () => {
  const operator = '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42';
  const owner = '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f';
  const { context, page, errors } = await fixturePage(() => {
    window.__delegatedWallet = { sends: 0, lastTx: null };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
          return ['0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42'];
        if (method === 'eth_chainId') return '0xc4cf';
        if (method === 'eth_sendTransaction') { window.__delegatedWallet.sends++;
          window.__delegatedWallet.lastTx = params[0]; throw Error('User rejected request'); }
        throw Error(`Unexpected method ${method}`);
      } };
  });
  let place = false, placePrepares = 0, crossed = false, staleOrder = false, cancelPrepares = 0;
  const tx = { chainId: 50383, from: operator,
    to: '0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0', owner,
    data: `0x80054449${'0'.repeat(64)}`, value: '0x0', gas: '0x300000', nonce: 0,
    expiresAt: new Date(Date.now() + 280000).toISOString(), maxGasCostStt: '0.015' };
  try {
    await page.route('**/api/v1/trade/account?**', route => route.fulfill({ json: {
      account: operator, market: 'BTC-PERP', block: '123', gasStt: '5', walletUsdso: '0',
      allowance: '0', marginUnlocked: '0', withdrawable: '0',
      position: { size: '0', entryPrice: '0' }, openOrders: [] } }));
    await page.route('**/api/v1/trade/delegated/account?**', route => route.fulfill({ json: {
      account: operator, owner, market: 'BTC-PERP', block: '456', gasStt: '5',
      marginUnlocked: '999.48', permissions: { place, cancel: place, reduce: place,
        scope: 'Wallet 1 BTC-PERP pool' }, position: { size: '0.05416', entryPrice: '80043.8' },
      openOrders: staleOrder ? [] : [{ id: '789', side: 'BUY', remaining: '0.00013', price: '79806.1' }] } }));
    await page.route('**/api/v1/trade/delegated/prepare', route => { placePrepares++; route.fulfill({ json: {
      status: place && !crossed ? 'READY' : 'BLOCKED', guard: { verdict: place && !crossed ? 'AMBER' : 'RED',
        blockers: crossed ? ['PostOnly limit would cross the opposite book top.'] :
          place ? [] : ['No effective placeOrderFor grant'], warnings: [],
        notionalRaw: '10374793000000000000' },
      observation: { chainId: 50383, observedAt: new Date().toISOString(), block: String(456 + placePrepares),
        account: { address: operator }, book: { status: 'TRUSTED', bid: '79806.1', ask: crossed ? '79806.1' : '79806.3' } },
      account: { owner, marginUnlocked: '999.48', permissions: { place } },
      marginPreview: { sufficient: true, lockUsdso: '10', asOfBlock: String(456 + placePrepares) },
      transaction: place && !crossed ? { ...tx, gas: placePrepares >= 3 ? '0x310000' : tx.gas } : null } }); });
    await page.route('**/api/v1/trade/delegated/cancel/prepare', route => { cancelPrepares++; route.fulfill(staleOrder ?
      { status: 409, json: { code: 'ORDER_NOT_OPEN', readBlock: '999',
        error: 'Order #789 is no longer open for Wallet 1 on BTC-PERP at on-chain block 999.' } } :
      { json: { status: 'READY', owner, orderId: '789',
        account: { owner, permissions: { cancel: true }, openOrders: [{ id: '789' }] },
        transaction: { ...tx, gas: cancelPrepares > 1 ? '0x320000' : '0x300000',
          data: `0xe37b444b${'0'.repeat(64)}` } } }); });
    await page.route('**/api/v1/trade/history?**', route => route.fulfill({ json: {
      owner, source: 'OFFICIAL_SDK_INDEXER_NONFINAL', note: 'Indexer history can lag.',
      rows: [{ id: '421', side: 'BUY', originalQuantity: '0.00013', price: '79806.1',
        filledQuantity: staleOrder ? '0.00013' : '0', status: staleOrder ? 'Filled' : 'Cancelled', endedAt: '2026-10-27T18:00:00Z',
        placedTxHash: `0x${'c'.repeat(64)}`, cancelReason: null }] } }));
    await page.locator('#wallet-connect').click();
    await page.locator('#mode-delegated').click();
    await page.locator('#wallet-permissions').getByText(/place BLOCKED/).waitFor();
    assert.equal(await page.locator('#compact-account-name').textContent(), 'Wallet 1');
    assert.equal(await page.locator('#compact-account-mode').textContent(), 'Delegated Perps');
    await page.locator('#wallet-permission-details summary').click();
    assert.match(await page.locator('#permission-eoa').textContent(), /0x/);
    await page.locator('#wallet-permission-details summary').click();
    assert.match(await page.locator('#wallet-balances').textContent(), /Wallet 1 free margin 999\.48/);
    await page.locator('#account-tab-button-positions').click();
    assert.equal(await page.locator('.position-table th').count(), 9);
    assert.match(await page.locator('.position-attribution').textContent(), /0\.00013 BTC/);
    await page.locator('.position-table-wrap').screenshot({ path: 'test-results/m74-position-table.png' });
    await page.locator('#account-tab-button-history').click();
    await page.locator('#load-order-history').click();
    await page.locator('#history-rows').getByText(/#421.*Cancelled/).waitFor();
    await page.locator('#quantity').fill('0.00013'); await page.locator('#use-bid').click();
    await page.locator('#review-order').click();
    await page.locator('#guard-verdict').getByText('RED').waitFor();
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 0);
    place = true; await page.locator('#refresh').click();
    await page.locator('#wallet-permissions').getByText(/place ACTIVE/).waitFor();
    await page.locator('#review-order').click();
    await page.locator('#trade-review').waitFor();
    assert.match(await page.locator('#review-details').textContent(), /Wallet 1/);
    assert.match(await page.locator('#review-calldata').textContent(), /placeOrderFor/);
    await page.locator('#historical-tools').click();
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/m53-delegated-review-mocked.png', fullPage: true });
    await page.locator('#confirm-wallet').click();
    await page.locator('#wallet-result').getByText(/User rejected request/).waitFor();
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 1);
    assert.equal(await page.evaluate(() => window.__delegatedWallet.lastTx.nonce), '0x0');
    assert.equal(await page.evaluate(() => window.__delegatedWallet.lastTx.gas), '0x310000');
    await page.locator('#review-order').click();
    await page.locator('#trade-review').waitFor();
    crossed = true;
    await page.locator('#confirm-wallet').click();
    await page.locator('#preflight-details').getByText(/book: PostOnly limit would cross/).waitFor();
    assert.match(await page.locator('#preflight-details').textContent(), /fresh bid 79806\.1 \/ ask 79806\.1/);
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 1);
    await page.locator('#account-tab-button-orders').click();
    await page.locator('.wallet-order-row button').click();
    await page.locator('#review-action').click();
    await page.locator('#action-review').waitFor();
    assert.match(await page.locator('#action-details').textContent(), /Cancel Wallet 1/);
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 1);
    await page.locator('#confirm-action').click();
    await page.locator('#action-result').getByText(/User rejected request/).waitFor();
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 2);
    assert.equal(await page.evaluate(() => window.__delegatedWallet.lastTx.gas), '0x320000');
    await page.locator('#account-tab-button-orders').click();
    await page.locator('.wallet-order-row button').click();
    staleOrder = true;
    await page.locator('#review-action').click();
    await page.locator('#action-result').getByText(/no longer open.*block 999/).waitFor();
    await page.locator('#account-tab-button-history').click();
    await page.locator('#history-rows').getByText(/#421.*Filled/).waitFor();
    assert.equal(await page.locator('.wallet-order-row').count(), 0);
    assert.equal(await page.locator('#action-order-id').inputValue(), '');
    assert.equal(await page.evaluate(() => window.__delegatedWallet.sends), 2);
    assert.deepEqual(errors.filter(message => !message.includes('409 (Conflict)')), []);
  } finally { await context.close(); }
});

test('real Chromium: verified market switching uses ETH decimals and resets observed chart', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    assert.equal(await page.locator('#market-select option').count(), 2);
    await page.locator('#market-select').selectOption('ETH-PERP');
    await page.locator('.chart-panel h2').getByText('ETH-PERP live mark trace').waitFor();
    assert.equal(await page.locator('#mark').textContent(), '2,346.15');
    assert.equal(await page.locator('#chart-count').textContent(), '1 observed quote');
    assert.match(await page.locator('.book-labels').textContent(), /QTY \(ETH\)/);
    await page.locator('#quantity').fill('0.004');
    await page.locator('#use-bid').click();
    assert.equal(await page.locator('#use-ask').isDisabled(), true);
    await page.locator('#sell').click();
    assert.equal(await page.locator('#use-bid').isDisabled(), true);
    await page.locator('#use-ask').click();
    assert.equal(await page.locator('#limit-price').inputValue(), '2346.50');
    await page.locator('#buy').click();
    await page.locator('#use-bid').click();
    assert.match(await page.locator('#notional').textContent(), /9\.39 USDso/);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium: market dialog search, favorites, recents and rapid switching', async () => {
  const { context, page, errors, setDelay } = await fixturePage();
  try {
    await page.locator('#open-market-selector').click();
    assert.equal(await page.locator('.market-list-row').count(), 2);
    await page.locator('#market-search').fill('ETH');
    assert.equal(await page.locator('.market-list-row').count(), 1);
    await page.locator('.market-favorite').click();
    await page.locator('[data-filter="favorites"]').click();
    assert.equal(await page.locator('.market-list-row').count(), 1);
    await page.locator('.market-row-select[data-symbol="ETH-PERP"]').click();
    assert.equal(await page.locator('#market-select').inputValue(), 'ETH-PERP');
    await page.locator('#book-badge').getByText('TRUSTED').waitFor();
    await page.locator('#open-market-selector').click();
    await page.locator('#market-search').fill('');
    await page.locator('[data-filter="recent"]').click();
    assert.equal(await page.locator('.market-list-row').count(), 1);
    await page.locator('#market-search').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.symbol), 'ETH-PERP');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#market-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-market-selector');
    setDelay(250);
    await page.locator('#market-select').selectOption('BTC-PERP');
    await page.locator('#market-select').selectOption('ETH-PERP');
    await page.waitForFunction(() => document.querySelector('#book-badge').textContent === 'TRUSTED' &&
      Number(document.querySelector('#book-bid').textContent.replaceAll(',', '')) < 10000);
    assert.equal(await page.locator('#market-select').inputValue(), 'ETH-PERP');
    assert.match(await page.locator('.book-labels').textContent(), /QTY \(ETH\)/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: BTC ETH BNB BTC clears market-specific order inputs', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    await page.route('**/api/v1/markets', route => route.fulfill({ json: { markets: [
      { id: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0', symbol: 'BTC-PERP', marketType: 'PERP', base: 'BTC', quote: 'USDso', status: 'TRADEABLE' },
      { id: '0xd6cb1dd58580b84d76068ac21594219ce03aeddf', symbol: 'ETH-PERP', marketType: 'PERP', base: 'ETH', quote: 'USDso', status: 'TRADEABLE' },
      { id: '0x2222222222222222222222222222222222222222', symbol: 'BNB-PERP', marketType: 'PERP', base: 'BNB', quote: 'USDso', status: 'TRADEABLE' },
    ] } }));
    await page.route('**/api/v1/markets/snapshot?market=BNB-PERP', route => {
      const bnb = market('34470002', '600');
      bnb.market = 'BNB-PERP'; bnb.book.bid = '599.99'; bnb.book.ask = '600.01';
      bnb.grid = { tickSizeRaw: '10000000000000000', lotSizeRaw: '100000000000000',
        minQuantityRaw: '1000000000000000', baseDecimals: 18, quoteDecimals: 18 };
      bnb.marketMeta = { base: 'BNB', quote: 'USDso' };
      route.fulfill({ json: bnb });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#market-select option').nth(2).waitFor({ state: 'attached' });
    for (const [symbol, base] of [['ETH-PERP', 'ETH'], ['BNB-PERP', 'BNB'], ['BTC-PERP', 'BTC']]) {
      await page.locator('#quantity').fill('0.01');
      await page.locator('#limit-price').fill('100');
      await page.locator('#market-select').selectOption(symbol);
      await page.locator('#book-badge').getByText('TRUSTED').waitFor();
      assert.equal(await page.locator('#quantity').inputValue(), '');
      assert.equal(await page.locator('#limit-price').inputValue(), '');
      assert.match(await page.locator('.book-labels').textContent(), new RegExp(`QTY \\(${base}\\)`));
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: candle zoom, pan, tooltip, timeframe and reset', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    const candles = Array.from({ length: 48 }, (_, i) => ({ time: 1793160000 + i * 300,
      open: String(79800 + i), high: String(79802 + i), low: String(79799 + i),
      close: String(79801 + i), volumeBase: '0.01', trades: 2 }));
    await page.route('**/api/v1/markets/candles?**', route => route.fulfill({ json: {
      status: 'AVAILABLE', source: 'MOCKED', observedAt: new Date().toISOString(), candles } }));
    await page.locator('#candle-interval').selectOption('900');
    await page.locator('#candle-canvas').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#candle-canvas').getAttribute('data-view-count'), '48');
    const box = await page.locator('#candle-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(await page.locator('#candle-hover').textContent(), /O .* H .* L .* C /);
    await page.mouse.wheel(0, -450);
    await page.waitForFunction(() => Number(document.querySelector('#candle-canvas').dataset.viewCount) < 48);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.up();
    assert.ok(Number(await page.locator('#candle-canvas').getAttribute('data-view-offset')) > 0);
    await page.locator('#candle-reset').click();
    assert.equal(await page.locator('#candle-canvas').getAttribute('data-view-count'), '48');
    assert.equal(await page.locator('#candle-canvas').getAttribute('data-view-offset'), '0');
    mkdirSync('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/m74-terminal-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: Radar scans markets, alerts cross once, and workspace navigation', async () => {
  const { context, page, errors, setMarket } = await fixturePage();
  try {
    await page.locator('#workspace-radar').click();
    assert.equal(await page.locator('#radar-rows tr').count(), 2);
    await page.locator('#radar-scan').click();
    await page.waitForFunction(() => !document.getElementById('radar-scan').disabled);
    assert.match(await page.locator('#radar-rows').textContent(), /BTC-PERP/);
    assert.match(await page.locator('#radar-rows').textContent(), /ETH-PERP/);
    assert.match(await page.locator('#radar-rows').textContent(), /\/100/);
    await page.locator('#radar-sort').selectOption('spread');
    assert.equal(await page.locator('#radar-rows tr').count(), 2);
    await page.locator('#radar-filter').selectOption('fresh');
    assert.equal(await page.locator('#radar-rows tr').count(), 2);
    await page.locator('#radar-filter').selectOption('all');
    mkdirSync('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/m8-market-radar-fixture.png', fullPage: true });
    setMarket({ error: 'BTC source temporarily unavailable' });
    await page.locator('#radar-scan').click();
    await page.waitForFunction(() => !document.getElementById('radar-scan').disabled);
    assert.match(await page.locator('#radar-rows tr').filter({ hasText: 'BTC-PERP' }).textContent(), /Unavailable/);
    assert.match(await page.locator('#radar-rows tr').filter({ hasText: 'ETH-PERP' }).textContent(), /\/100/);
    setMarket(market());
    await page.locator('#radar-rows tr').filter({ hasText: 'ETH-PERP' }).getByRole('button', { name: 'Inspect market' }).click();
    assert.equal(await page.locator('#market-select').inputValue(), 'ETH-PERP');
    await page.locator('#market-select').selectOption('BTC-PERP');
    await page.locator('#workspace-alerts').click();
    await page.locator('#alert-market').selectOption('BTC-PERP');
    await page.locator('#alert-type').selectOption('PRICE_ABOVE');
    await page.locator('#alert-threshold').fill('79900');
    await page.locator('#alert-save').click();
    await page.locator('#alerts-check').click();
    await page.waitForFunction(() => !document.getElementById('alerts-check').disabled);
    assert.equal(await page.locator('#alert-events p').count(), 0);
    setMarket(market('34470002', '80000'));
    await page.locator('#alerts-check').click();
    await page.waitForFunction(() => !document.getElementById('alerts-check').disabled);
    assert.equal(await page.locator('#alert-events p').count(), 1);
    await page.locator('#alerts-check').click();
    await page.waitForFunction(() => !document.getElementById('alerts-check').disabled);
    assert.equal(await page.locator('#alert-events p').count(), 1);
    await page.locator('#alert-events button').click();
    assert.match(await page.locator('#alert-events').textContent(), /acknowledged/);
    await page.screenshot({ path: 'docs/screenshots/m8-alerts-fixture.png', fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#workspace-alerts').click();
    assert.equal(await page.locator('.product-alert').count(), 1);
    await page.locator('.product-alert button').getByText('Edit').click();
    await page.locator('#alert-threshold').fill('80500');
    await page.locator('#alert-save').click();
    assert.match(await page.locator('.product-alert').textContent(), /80500/);
    await page.locator('.product-alert button').getByText('Pause').click();
    assert.match(await page.locator('.product-alert').textContent(), /PAUSED/);
    await page.locator('.product-alert button').getByText('Delete').click();
    assert.equal(await page.locator('.product-alert').count(), 0);
    await page.locator('#workspace-plan').click();
    await page.locator('.sizing-card').screenshot({ path: 'docs/screenshots/m8-position-sizing-fixture.png' });
    await page.locator('#workspace-terminal').click();
    await page.screenshot({ path: 'docs/screenshots/m8-terminal-fixture.png', fullPage: true });
    assert.deepEqual(errors.filter(message => !message.includes('503 (Service Unavailable)')), []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: journal pages deduplicate, filter, export and keep source limits', async () => {
  const { context, page, errors } = await fixturePage(() => {
    window.ethereum = { on() {}, async request({ method }) {
      if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0xc4cf';
      throw Error('Unexpected wallet method');
    } };
  });
  try {
    await page.route('**/api/v1/trade/history?**', route => {
      const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
      route.fulfill({ json: { owner: '0x1111111111111111111111111111111111111111',
        note: 'SDK indexer can lag', nextOffset: offset === 0 ? 20 : null,
        rows: offset === 0 ? [{ id: '42', side: 'BUY', price: '79800', originalQuantity: '0.1',
          filledQuantity: '0', status: 'Cancelled', endedAt: '2026-10-27T18:00:00Z', placedTxHash: '0xabc' }] :
          [{ id: '42', side: 'BUY', price: '79800', originalQuantity: '0.1', filledQuantity: '0.05',
            status: 'Filled', endedAt: '2026-10-27T18:00:00Z', placedTxHash: '0xabc' },
          { id: '43', side: 'SELL', price: '80000', originalQuantity: '0.2', filledQuantity: '0',
            status: 'Cancelled', endedAt: '2026-10-27T19:00:00Z', placedTxHash: '0xdef' }] } });
    });
    await page.locator('#workspace-journal').click();
    await page.locator('#journal-rows tr').first().waitFor();
    await page.locator('#journal-more').click();
    await page.waitForFunction(() => !document.getElementById('journal-more').disabled ||
      document.getElementById('journal-status').textContent.includes('last page'));
    assert.equal(await page.locator('#journal-rows tr').count(), 2);
    assert.match(await page.locator('#journal-analytics').textContent(), /0\.05000000 BTC/);
    await page.locator('#journal-status-filter').selectOption('Filled');
    assert.equal(await page.locator('#journal-rows tr').count(), 1);
    await page.locator('#journal-date-filter').fill('2026-10-28');
    assert.equal(await page.locator('#journal-rows tr').count(), 0);
    await page.locator('#journal-date-filter').fill('');
    await page.locator('#journal-evidence-filter').selectOption('verified');
    assert.equal(await page.locator('#journal-rows tr').count(), 0);
    await page.locator('#journal-evidence-filter').selectOption('all');
    assert.equal(await page.locator('#journal-rows tr').count(), 1);
    assert.equal(await page.locator('#journal-export').isEnabled(), true);
    const download = page.waitForEvent('download');
    await page.locator('#journal-export').click();
    assert.equal((await download).suggestedFilename(), 'perp-canary-journal.csv');
    await page.screenshot({ path: 'docs/screenshots/m8-trade-journal-fixture.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('real Chromium MOCKED: slow historical read never blocks market switching or book', async () => {
  const { context, page, errors } = await fixturePage();
  try {
    await page.route('**/api/v1/terminal/history', async route => {
      await new Promise(resolve => setTimeout(resolve, 2500));
      await route.fulfill({ status: 503, json: { error: 'History indexer delayed' } });
    });
    await page.locator('#refresh').click();
    await page.locator('#market-select').selectOption('ETH-PERP');
    await page.locator('#book-badge').getByText('TRUSTED').waitFor();
    assert.equal(await page.locator('#market-select').inputValue(), 'ETH-PERP');
    await page.locator('#sell').click();
    assert.equal(await page.locator('#use-ask').isEnabled(), true);
    await page.locator('#timeline').getByText(/Read-only RPC history unavailable/).waitFor();
    assert.deepEqual(errors.filter(message => !message.includes('503 (Service Unavailable)')), []);
  } finally { await context.close(); }
});

test('real Chromium: degraded transport reports source and blocks stale book actions', async () => {
  const { context, page, errors, setMarket } = await fixturePage();
  try {
    await page.route('**/api/v1/health/sources?**', route => route.fulfill({ json: {
      market: 'BTC-PERP', rpc: { status: 'HEALTHY', code: 'OK', detail: 'HTTP RPC responds' },
      websocket: { status: 'UNAVAILABLE', code: 'NETWORK_PERMISSION', detail: 'WebSocket blocked' },
      indexer: { status: 'HEALTHY', code: 'OK', detail: 'Indexer responds' },
      pool: { status: 'HEALTHY', code: 'OK', detail: 'Pool active' } } }));
    setMarket({ error: 'WebSocket transport unavailable' });
    await page.locator('#refresh').click();
    await page.locator('.source-chip').getByText('WebSocket offline').waitFor();
    await page.locator('#book-badge').getByText('UNTRUSTED').waitFor();
    assert.equal(await page.locator('#use-bid').isDisabled(), true);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    await page.locator('#source-health details summary').click();
    assert.match(await page.locator('.source-details').textContent(), /WebSocket blocked/);
    assert.ok(errors.some(error => error.includes('503')));
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
            !node.closest('.account-tabs') && node.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map(node =>
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
      assert.ok(layout.shell >= Math.min(1880, width * .94) && layout.shell <= width * .97,
        `shell width at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.fonts.body >= 15 && layout.fonts.secondary >= 12 && layout.fonts.button >= 14 &&
        layout.fonts.input >= 15 && layout.fonts.price >= 22 && layout.fonts.heading >= 17,
      `typography at ${width}: ${JSON.stringify(layout.fonts)}`);
      assert.ok(layout.chart.width > (width < 550 ? 250 : 300) &&
        layout.book.width > (width < 550 ? 250 : 300) && layout.trade.width > (width < 550 ? 250 : 300),
        `panel width at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.tableFits && layout.proofFits, true, `table or hash overflow at ${width}: ${JSON.stringify(layout)}`);
      if (width >= 1351) {
        assert.ok(layout.chart.x < layout.book.x && layout.book.x < layout.trade.x &&
          Math.abs(layout.chart.y - layout.book.y) < 2 && Math.abs(layout.book.y - layout.trade.y) < 2,
        `desktop panel order at ${width}: ${JSON.stringify(layout)}`);
      } else if (width >= 901) {
        assert.ok(layout.chart.x < layout.book.x && layout.chart.y < layout.trade.y &&
          layout.trade.y < layout.risk.y && layout.portfolio.x < layout.proof.x,
        `laptop panel order at ${width}: ${JSON.stringify(layout)}`);
      } else if (width >= 801) {
        assert.ok(layout.chart.x < layout.book.x && layout.chart.y < layout.trade.y &&
          layout.trade.y < layout.risk.y && layout.risk.y < layout.portfolio.y &&
          layout.portfolio.y < layout.proof.y,
          `tablet panel order at ${width}: ${JSON.stringify(layout)}`);
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
  await page.route('**/api/v1/markets/snapshot?**', route => route.fulfill({ json: market('34470000', '79800', 40000) }));
  await page.route('**/api/v1/markets', route => route.fulfill({ json: { markets: [
    { symbol: 'BTC-PERP', quote: 'USDso', status: 'TRADEABLE' }] } }));
  await page.route('**/api/v1/terminal/history', route => route.fulfill({ json: history }));
  await page.route('**/api/v1/terminal/account', route => route.fulfill({ json: {
    readBlock: history.readBlock, position: history.position, openOrders: history.openOrders } }));
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

test('local source health route rejects invalid market input before network access', async () => {
  const response = await fetch(`${base}/api/v1/health/sources?market=../BTC-PERP`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid perp market symbol' });
});

test('real Chromium: live RPC smoke', { skip: process.env.CANARY_UI_LIVE !== '1' }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#historical-tools').click();
    await page.locator('#proof-badge').getByText('VERIFIED').waitFor({ timeout: 15000 });
    await page.locator('#book-badge').getByText('TRUSTED', { exact: true }).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.getElementById('position-block').textContent.includes('REFRESHING'),
      undefined, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('timeline').textContent.includes('Reading verified proof'),
      undefined, { timeout: 30000 });
    const liveHistory = await page.locator('#order-state').textContent();
    assert.match(liveHistory, /^(NOT_OPEN_AT_READ|UNKNOWN)$/);
    if (liveHistory === 'UNKNOWN') {
      const timeline = await page.locator('#timeline').textContent();
      assert.match(timeline, /Read-only RPC history unavailable/);
      process.stdout.write(`LIVE HISTORY UNAVAILABLE ${timeline}\n`);
    }
    assert.match(await page.locator('#order-cause').textContent(), /^(UNKNOWN|OrderExpired)$/);
    assert.equal(await page.locator('#copy-prepare').isDisabled(), true);
    await page.locator('#refresh').click();
    await page.locator('#chart-count').getByText(/[2-9] observed quotes/).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.getElementById('refresh').disabled &&
      !document.getElementById('position-block').textContent.includes('REFRESHING'),
    undefined, { timeout: 90000 });
    assert.match(await page.locator('#chart-count').textContent(), /[2-9] observed quotes/);
    assert.deepEqual(errors, []);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/ui-qa-live.png', fullPage: true });
  } finally { await context.close(); }
});

test('real Chromium: live M8 Radar and SDK Journal read-only smoke',
  { skip: process.env.CANARY_UI_LIVE_RADAR !== '1', timeout: 300000 }, async () => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => { window.ethereum = { on() {}, async request({ method }) {
      if (method === 'eth_accounts') return ['0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42'];
      if (method === 'eth_chainId') return '0xc4cf';
      throw Error('Read-only live smoke blocks signing and sending');
    } }; });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('#workspace-radar').click();
      await page.waitForFunction(() => document.querySelectorAll('#radar-rows tr').length === 21,
        undefined, { timeout: 90000 });
      await page.locator('#radar-scan').click();
      await page.waitForFunction(() => !document.getElementById('radar-scan').disabled,
        undefined, { timeout: 240000 });
      const coverage = await page.locator('#radar-rows tr').count();
      const scored = await page.locator('#radar-rows tr').filter({ hasText: /\/100/ }).count();
      process.stdout.write(`LIVE M8 RADAR ${JSON.stringify({ coverage, scored,
        progress: await page.locator('#radar-progress').textContent() })}\n`);
      assert.equal(coverage, 21);
      assert.ok(scored > 0, 'at least one market must have fresh trusted quote and depth');
      assert.doesNotMatch(await page.locator('#radar-rows').textContent(), /Invalid Date/);
      mkdirSync('docs/screenshots', { recursive: true });
      await page.screenshot({ path: 'docs/screenshots/m8-market-radar-live.png', fullPage: true });
      await page.locator('#workspace-terminal').click();
      await page.locator('#mode-delegated').click();
      await page.locator('#workspace-journal').click();
      await page.waitForFunction(() => !document.getElementById('journal-load').disabled,
        undefined, { timeout: 45000 });
      process.stdout.write(`LIVE M8 JOURNAL ${await page.locator('#journal-status').textContent()}\n`);
      await page.screenshot({ path: 'docs/screenshots/m8-trade-journal-live.png', fullPage: true });
    } finally { await context.close(); }
  });

test('real Chromium: live M8 Journal evidence columns',
  { skip: process.env.CANARY_UI_LIVE_JOURNAL !== '1', timeout: 90000 }, async () => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => { window.ethereum = { on() {}, async request({ method }) {
      if (method === 'eth_accounts') return ['0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42'];
      if (method === 'eth_chainId') return '0xc4cf';
      throw Error('Read-only live smoke blocks signing and sending');
    } }; });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('#mode-delegated').click();
      await page.locator('#workspace-journal').click();
      await page.locator('#journal-rows tr').first().waitFor({ timeout: 45000 });
      await page.locator('#journal-rows tr').filter({ hasText: '14978756187852164141712' }).getByText('MAKER').waitFor();
      assert.match(await page.locator('#journal-rows').textContent(), /Only 0\.00013 BTC increment/);
      mkdirSync('docs/screenshots', { recursive: true });
      await page.screenshot({ path: 'docs/screenshots/m8-trade-journal-live.png', fullPage: true });
    } finally { await context.close(); }
  });
