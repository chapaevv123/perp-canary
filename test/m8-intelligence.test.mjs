import test from 'node:test';
import assert from 'node:assert/strict';
import { marketScore, evaluateAlert, mergeOrderPages, sourceTime } from '../web/product-intelligence.js';

const now = Date.parse('2026-10-28T12:00:00Z');
const sample = (bid = '100', ask = '100.1', status = 'TRUSTED', at = new Date(now - 1000).toISOString()) => ({
  mark: '100.05', market: 'BTC-PERP', book: { status, bid, ask, observedAt: at, source: 'SDK_ONCHAIN' },
  depth: { status: 'VERIFIED', bids: [{ quantity: '0.2' }], asks: [{ quantity: '0.3' }] },
  marketMeta: { fundingRateWindowPercent: '0.01' },
});

test('quality score requires fresh trusted quotes and verified depth and explains components', () => {
  const fresh = marketScore(sample(), { lastTradeAt: new Date(now - 1000).toISOString() }, now);
  assert.equal(fresh.score, 30 + 23 + 10 + 15);
  assert.match(fresh.reason, /Operational data quality only/);
  assert.equal(marketScore(sample('100', '100.1', 'TRUSTED', new Date(now - 31_000).toISOString()), {}, now).score, null);
  assert.equal(marketScore({ ...sample(), depth: { status: 'UNAVAILABLE' } }, {}, now).score, null);
  assert.equal(marketScore(sample('100.1', '100'), {}, now).score, null);
});

test('alerts trigger on verified threshold crossing, deduplicate and reject stale prices', () => {
  const alert = { type: 'PRICE_ABOVE', threshold: '100', lastValue: 99, triggeredAtMs: 0 };
  assert.equal(evaluateAlert(alert, sample(), now).triggered, true);
  assert.equal(evaluateAlert({ ...alert, triggeredAtMs: now - 1000 }, sample(), now).triggered, false);
  assert.equal(evaluateAlert(alert, sample('100', '100.1', 'TRUSTED', new Date(now - 31_000).toISOString()), now).triggered, false);
  assert.equal(evaluateAlert({ type: 'FEED_STALE', lastValue: 1 }, null, now).triggered, true);
  assert.equal(evaluateAlert({ type: 'FEED_RECOVERED', lastValue: 0 }, sample(), now).triggered, true);
  assert.equal(evaluateAlert({ type: 'FUNDING_ABOVE', threshold: '0.005', lastValue: 0.001 },
    { ...sample(), marketMeta: { fundingRateWindowPercent: null } }, now).triggered, false);
});

test('journal pages reconcile by canonical order ID', () => {
  assert.deepEqual(mergeOrderPages([{ id: '42', status: 'Cancelled' }],
    [{ id: '42', status: 'Filled' }, { id: '43', status: 'Partial' }]),
  [{ id: '42', status: 'Filled' }, { id: '43', status: 'Partial' }]);
});

test('indexer activity timestamps accept seconds, milliseconds and ISO without Invalid Date', () => {
  assert.equal(sourceTime('1793188800'), 1793188800000);
  assert.equal(sourceTime('1793188800000'), 1793188800000);
  assert.equal(sourceTime('2026-10-28T12:00:00Z'), now);
  assert.equal(sourceTime(null), null);
});
