import test from 'node:test';
import assert from 'node:assert/strict';
import { explainGuard } from '../web/guard-v2.js';
import { priceScenario } from '../web/position-scenario.js';

const draft = { mode: 'DELEGATED_PERPS', account: '0xOperator', owner: '0xOwner',
  market: 'BTC-PERP', side: 'BUY', quantity: '0.00013', price: '80880' };
const base = { status: 'READY', guard: { blockers: [], warnings: [] },
  observation: { chainId: 50383, block: '10', book: { status: 'TRUSTED',
    bid: '80870', ask: '80880', block: '10' } },
  account: { marginUnlocked: '999', block: '10', permissions: { place: true } },
  marginPreview: { sufficient: true, lockUsdso: '10', asOfBlock: '10' },
  transaction: { to: '0xPool', maxGasCostStt: '0.01', nonce: 1, expiresAt: '2026-10-27T20:00:00Z' } };

test('Guard V2 explains a reviewable order and retains provenance', () => {
  const report = explainGuard(base, draft);
  assert.equal(report.decision, 'SAFE TO REVIEW');
  assert.equal(report.checks.length, 8);
  assert.equal(report.checks.find(row => row.name === 'Contract simulation').status, 'PASS');
  assert.equal(report.checks.find(row => row.name === 'Market & book').freshness, '10');
});

test('Guard V2 soft spread caution never overrides a hard block', () => {
  const caution = explainGuard({ ...base, observation: { ...base.observation,
    book: { ...base.observation.book, ask: '81200' } } }, draft, 25);
  assert.equal(caution.decision, 'CAUTION');
  const blocked = explainGuard({ ...base, status: 'BLOCKED',
    guard: { blockers: ['No effective placeOrderFor grant'], warnings: [] }, transaction: null,
    account: { ...base.account, permissions: { place: false } } }, draft, 100);
  assert.equal(blocked.decision, 'BLOCKED');
  assert.match(blocked.nextAction, /grant/);
  assert.equal(explainGuard(null, draft).decision, 'UNAVAILABLE');
});

test('price-only scenario uses signed exact decimal arithmetic', () => {
  const long = { sizeRaw: '100000000', entryRaw: '90000000000000000000',
    markRaw: '100000000000000000000', baseDecimals: 8 };
  assert.equal(priceScenario(long, 5).estimatedPnlUsdso, '15');
  assert.equal(priceScenario({ ...long, sizeRaw: '-100000000' }, 5).estimatedPnlUsdso, '-15');
  assert.throws(() => priceScenario(long, 31), /-30/);
});
