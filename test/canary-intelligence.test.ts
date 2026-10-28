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

test('position sizing keeps BTC, ETH and low-priced market precision separate', () => {
  const btc = calculatePositionSize({ capital: '100', riskPercent: '1', entry: '80000', stop: '79000', side: 'BUY',
    baseDecimals: 8, quoteDecimals: 18, tickSizeRaw: '100000000000000000',
    lotSizeRaw: '1000', minQuantityRaw: '13000', initialMarginBps: 500, availableMarginUsdso: '5' });
  assert.equal(btc.status, 'CALCULATED'); assert.equal(btc.confidence, 'ESTIMATED');
  assert.equal(btc.invalidationDistancePercent, '1.25');
  const eth = calculatePositionSize({ capital: '100', riskPercent: '1', entry: '2500', stop: '2450', side: 'BUY',
    baseDecimals: 18, quoteDecimals: 18, tickSizeRaw: '10000000000000000',
    lotSizeRaw: '100000000000000', minQuantityRaw: '4000000000000000', initialMarginBps: 500 });
  assert.equal(eth.quantity, '0.02'); assert.equal(eth.notionalUsdso, '50');
  const ada = calculatePositionSize({ capital: '100', riskPercent: '5', entry: '0.5', stop: '0.45', side: 'BUY',
    baseDecimals: 6, quoteDecimals: 18, tickSizeRaw: '100000000000000',
    lotSizeRaw: '1000000', minQuantityRaw: '46000000', initialMarginBps: 1000 });
  assert.equal(ada.quantity, '100'); assert.equal(ada.notionalUsdso, '50');
  assert.throws(() => calculatePositionSize({ capital: '100', riskPercent: '1', entry: '0.50001', stop: '0.45', side: 'BUY',
    baseDecimals: 6, quoteDecimals: 18, tickSizeRaw: '100000000000000',
    lotSizeRaw: '1000000', minQuantityRaw: '46000000', initialMarginBps: 1000 }), /tick size/);
  assert.equal(calculatePositionSize({ capital: '100', riskPercent: '', absoluteRiskUsdso: '2', entry: '2500', stop: '2450', side: 'BUY',
    baseDecimals: 18, quoteDecimals: 18, lotSizeRaw: '100000000000000', minQuantityRaw: '4000000000000000',
    initialMarginBps: 500, availableMarginUsdso: '1' }).status, 'INSUFFICIENT_MARGIN_ESTIMATE');
});
