import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDelegatedCancel, comparePreflight } from '../web/preflight-compare.js';

const operator = '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42';
const owner = '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f';
const pool = '0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0';
const now = Date.now();
const input = { mode: 'DELEGATED_PERPS', account: operator, owner, market: 'BTC-PERP',
  side: 'BUY', orderType: 'POST_ONLY', price: '80825', quantity: '0.00013' };
const tx = { chainId: 50383, from: operator, owner, to: pool, data: '0x80054449deadbeef',
  value: '0x0', gas: '0x250000', nonce: 0, expiresAt: new Date(now + 280_000).toISOString(),
  maxGasCostStt: '0.015275964' };
const reviewed = { input, result: { transaction: tx, observation: { block: '100' } } };
const fresh = { status: 'READY', guard: { blockers: [] }, transaction: tx,
  observation: { block: '101', book: { bid: '80825.1', ask: '80825.2' } },
  account: { marginUnlocked: '999.48', permissions: { place: true } },
  marginPreview: { sufficient: true } };
const check = (patch = {}, currentInput = input, time = now) =>
  comparePreflight(reviewed, currentInput, { ...fresh, ...patch }, time);
const fields = verdict => verdict.issues.map(issue => issue.field);

test('stable user intent survives a new market block and a noncrossing moving book', () => {
  const result = check({ observation: { block: '999', book: { bid: '80840', ask: '80841' } } });
  assert.equal(result.ok, true);
  assert.deepEqual(fields(result), []);
  assert.ok(result.changes.some(change => change.field === 'block' && change.material === false));
});

test('fresh validated gas estimate may change and the fresh value is sent to wallet', () => {
  const result = check({ transaction: { ...tx, gas: '0x260000', maxGasCostStt: '0.016' } });
  assert.equal(result.ok, true);
  assert.ok(result.changes.some(change => change.field === 'gas' && change.material === false));
  assert.equal(result.context.gasEstimateStt, '0.016');
});

test('PostOnly crossing blocks with current book top and selected limit', () => {
  const result = check({ status: 'BLOCKED', transaction: null,
    guard: { blockers: ['PostOnly limit would cross the opposite book top.'] },
    observation: { block: '102', book: { bid: '80824.9', ask: '80825' } } });
  assert.equal(result.ok, false);
  assert.ok(fields(result).includes('book'));
  assert.equal(result.context.ask, '80825');
  assert.equal(result.context.limitPrice, '80825');
});

test('expired review and changed expiry each require a new review', () => {
  assert.ok(fields(check({}, input, now + 260_000)).includes('expiry'));
  assert.ok(fields(check({ transaction: { ...tx, expiresAt: new Date(now + 290_000).toISOString() } })).includes('expiry'));
});

test('revoked grant and insufficient owner margin remain blockers', () => {
  const revoked = check({ status: 'BLOCKED', transaction: null,
    guard: { blockers: ['No effective placeOrderFor grant'] },
    account: { marginUnlocked: '999.48', permissions: { place: false } } });
  assert.ok(fields(revoked).includes('permission'));
  const margin = check({ status: 'BLOCKED', transaction: null,
    guard: { blockers: ['Owner MarginBank preview cannot prove sufficient collateral'] },
    marginPreview: { sufficient: false },
    account: { marginUnlocked: '0', permissions: { place: true } } });
  assert.ok(fields(margin).includes('margin'));
  assert.equal(margin.context.marginUsdso, '0');
});

test('nonce, owner, operator, target, calldata and value changes are material', () => {
  for (const [field, transaction] of [
    ['nonce', { nonce: 1 }], ['owner', { owner: operator }], ['operator', { from: owner }],
    ['pool', { to: owner }], ['calldata', { data: '0x80054449beef' }], ['value', { value: '0x1' }],
  ]) assert.ok(fields(check({ transaction: { ...tx, ...transaction } })).includes(field), field);
});

test('changed price, quantity, side, account or mode invalidates immutable intent', () => {
  for (const [field, value] of [['price', '80824.9'], ['quantity', '0.00014'],
    ['side', 'SELL'], ['account', owner], ['mode', 'DIRECT']])
    assert.ok(fields(check({}, { ...input, [field]: value })).includes(field), field);
});

test('contract simulation failure blocks even when calldata intent is unchanged', () => {
  const result = check({ status: 'BLOCKED', transaction: null,
    guard: { blockers: ['Delegated contract simulation failed: reverted'] } });
  assert.equal(result.ok, false);
  assert.ok(fields(result).includes('simulation'));
});

test('multiple fresh attempts do not mutate the original review', () => {
  const first = check({ status: 'BLOCKED', transaction: null,
    guard: { blockers: ['PostOnly limit would cross the opposite book top.'] } });
  const second = check({ transaction: { ...tx, gas: '0x260000' } });
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(reviewed.result.transaction.gas, '0x250000');
});

const cancelInput = { mode: 'DELEGATED_PERPS', account: operator, owner, market: 'BTC-PERP',
  action: 'CANCEL', orderId: '14978756187852164141712' };
const cancelTx = { chainId: 50383, from: operator, to: pool, data: '0xe37b444bdeadbeef',
  value: '0x0', gas: '0x200000', nonce: 0, maxGasCostStt: '0.012' };
const cancelReview = { input: cancelInput, result: { transaction: cancelTx } };
const cancelFresh = { status: 'READY', owner, orderId: cancelInput.orderId, transaction: cancelTx,
  account: { owner, permissions: { cancel: true }, openOrders: [{ id: cancelInput.orderId }] } };
const cancelCheck = (patch = {}, currentInput = cancelInput) =>
  compareDelegatedCancel(cancelReview, currentInput, { ...cancelFresh, ...patch });

test('delegated cancellation accepts fresh gas only while order and grant remain live', () => {
  const result = cancelCheck({ transaction: { ...cancelTx, gas: '0x220000', maxGasCostStt: '0.013' } });
  assert.equal(result.ok, true);
  assert.equal(result.gasChanged, true);
});

test('stale open-order row, revoked cancel grant and wrong owner block cancellation', () => {
  assert.ok(cancelCheck({ account: { ...cancelFresh.account, openOrders: [] } }).issues.some(x => x.field === 'openOrder'));
  assert.ok(cancelCheck({ account: { ...cancelFresh.account, permissions: { cancel: false } } }).issues.some(x => x.field === 'permission'));
  assert.ok(cancelCheck({ owner: operator }).issues.some(x => x.field === 'owner'));
});

test('cancellation refuses changed ID, nonce, calldata, pool and excessive gas', () => {
  assert.ok(cancelCheck({}, { ...cancelInput, orderId: 'other' }).issues.some(x => x.field === 'orderId'));
  assert.ok(cancelCheck({ transaction: { ...cancelTx, nonce: 1 } }).issues.some(x => x.field === 'nonce'));
  assert.ok(cancelCheck({ transaction: { ...cancelTx, data: '0xe37b444b00' } }).issues.some(x => x.field === 'calldata'));
  assert.ok(cancelCheck({ transaction: { ...cancelTx, to: owner } }).issues.some(x => x.field === 'pool'));
  assert.ok(cancelCheck({ transaction: { ...cancelTx, maxGasCostStt: '0.101' } }).issues.some(x => x.field === 'gas'));
});
