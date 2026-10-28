import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readExecutionReplay, buildExecutionReplay } from '../src/execution-replay.ts';
import { scenarioPnl } from '../src/position-intelligence.ts';
import { publicOrigin, publicRequestRejection, publicRouteAllowed, RequestLimiter, securityHeaders } from '../src/server-security.ts';

test('Render public origin uses only the provider-assigned exact HTTPS URL', () => {
  const saved = Object.fromEntries(['CANARY_PUBLIC_ENABLED', 'CANARY_PUBLIC_ORIGIN', 'RENDER',
    'RENDER_EXTERNAL_URL'].map(key => [key, process.env[key]]));
  try {
    process.env.CANARY_PUBLIC_ENABLED = '1';
    delete process.env.CANARY_PUBLIC_ORIGIN;
    process.env.RENDER = 'true';
    process.env.RENDER_EXTERNAL_URL = 'https://perp-canary.onrender.com';
    assert.equal(publicOrigin()?.origin, 'https://perp-canary.onrender.com');
    process.env.RENDER_EXTERNAL_URL = 'http://perp-canary.onrender.com';
    assert.throws(publicOrigin, /exact HTTPS origin/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('verified order replay identifies exact fill and does not invent preflight', async () => {
  const replay = await readExecutionReplay('14978756187852164141712');
  assert.equal(replay.chainId, 50383);
  assert.equal(replay.steps.find(row => row.label === 'Preflight and simulation')?.status, 'UNAVAILABLE');
  assert.equal(replay.steps.find(row => row.label === 'OrderFilled')?.status, 'FULL_FILL');
  assert.equal(replay.fillHash, '0x1b7e19bb1afbf14ed21e74da7cf667ccb17c40ec310698293dbd6e4c343f65d4');
  await assert.rejects(readExecutionReplay('../private'), /No verified replay/);
});

test('replay rejects a mismatched or partial fill', async () => {
  const evidence = JSON.parse(await readFile(resolve('docs/evidence/verified-delegated-btc-order.json'), 'utf8'));
  evidence.events.find((row: { name: string }) => row.name === 'OrderFilled').makerRemaining = '1';
  assert.throws(() => buildExecutionReplay(evidence), /fully filled/);
});

test('position scenario uses signed bigint size and excludes funding', () => {
  assert.equal(scenarioPnl(100_000_000n, 90n * 10n ** 18n, 100n * 10n ** 18n, 8, 500).estimatedPnlUsdso, '15');
  assert.equal(scenarioPnl(-100_000_000n, 90n * 10n ** 18n, 100n * 10n ** 18n, 8, 500).estimatedPnlUsdso, '-15');
  assert.throws(() => scenarioPnl(1n, 1n, 1n, 8, 5001), /-50%/);
});

test('public route allowlist blocks legacy and bot routes; HTTPS origin and rate limit are exact', () => {
  const origin = new URL('https://terminal.example.org');
  assert.equal(publicRouteAllowed('/api/v1/trade/delegated/prepare', 'POST'), true);
  assert.equal(publicRouteAllowed('/product-workspaces.js', 'GET'), true);
  assert.equal(publicRouteAllowed('/product-intelligence.js', 'GET'), true);
  assert.equal(publicRouteAllowed('/product-workspaces.js', 'POST'), false);
  assert.equal(publicRouteAllowed('/api/v1/bot-execution', 'GET'), false);
  assert.equal(publicRouteAllowed('/legacy', 'GET'), false);
  assert.equal(publicRequestRejection({ path: '/api/v1/trade/prepare', method: 'POST',
    host: 'terminal.example.org', origin: 'https://terminal.example.org' }, origin), null);
  assert.match(publicRequestRejection({ path: '/api/v1/trade/prepare', method: 'POST',
    host: 'terminal.example.org', origin: 'https://evil.example.org' }, origin)!, /same-origin/);
  assert.match(publicRequestRejection({ path: '/legacy', method: 'GET',
    host: 'terminal.example.org' }, origin)!, /Route/);
  assert.match(securityHeaders(true)['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  const limiter = new RequestLimiter();
  assert.equal(limiter.allow('user', 0, 2), true);
  assert.equal(limiter.allow('user', 1, 2), true);
  assert.equal(limiter.allow('user', 2, 2), false);
  assert.equal(limiter.allow('user', 60_000, 2), true);
});
