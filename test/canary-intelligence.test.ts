import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMarketRadar, calculatePositionSize } from '../src/canary-intelligence.ts';

test('sizing uses bigint units, lot rounding and labels stop as a reference', () => {
  const result = calculatePositionSize({ capital: '100', riskPercent: '1', entry: '80000', stop: '79000', side: 'BUY',
    baseDecimals: 8, quoteDecimals: 18, lotSizeRaw: '1000', minQuantityRaw: '13000',
    initialMarginBps: 500 });
  assert.equal(result.status, 'CALCULATED');
  assert.equal(result.quantity, '0.001');
  assert.equal(result.notionalUsdso, '80');
  assert.equal(result.lossAtStopUsdso, '1');
  assert.equal(result.initialMarginUsdso, '4');
  assert.match(result.assumptions, /not an installed order/);
  const small = calculatePositionSize({ capital: '1', riskPercent: '1', entry: '80000', stop: '79000', side: 'BUY',
    baseDecimals: 8, quoteDecimals: 18, lotSizeRaw: '1000', minQuantityRaw: '13000',
    initialMarginBps: 500 });
  assert.equal(small.status, 'BELOW_MINIMUM');
  const capped = calculatePositionSize({ capital: '10000', riskPercent: '1', entry: '80000', stop: '79000', side: 'BUY',
    baseDecimals: 8, quoteDecimals: 18, lotSizeRaw: '1000', minQuantityRaw: '13000',
    initialMarginBps: 500 });
  assert.equal(capped.cappedByGuard, true);
  assert.equal(capped.notionalUsdso, '100');
  assert.throws(() => calculatePositionSize({ capital: '100', riskPercent: '1', entry: '80000',
    stop: '81000', side: 'BUY', baseDecimals: 8, quoteDecimals: 18, lotSizeRaw: '1000',
    minQuantityRaw: '13000', initialMarginBps: 500 }), /Stop reference/);
});

test('radar distinguishes stale data from spread and visible-depth warnings', () => {
  const now = Date.now(), observedAt = new Date(now).toISOString();
  const base = { status: 'TRUSTED', mark: '100', bid: '99', ask: '101', observedAt,
    bidLevels: [{ price: '99', quantity: '9' }], askLevels: [{ price: '101', quantity: '1' }] };
  const radar = assessMarketRadar(base, { ...base, mark: '99' }, now);
  assert.equal(radar.status, 'WATCH');
  assert.ok(radar.alerts.some(value => /Spread/.test(value)));
  assert.ok(radar.alerts.some(value => /imbalance/.test(value)));
  assert.equal(assessMarketRadar({ ...base, observedAt: new Date(now - 31_000).toISOString() }, undefined, now).status,
    'UNKNOWN');
});
