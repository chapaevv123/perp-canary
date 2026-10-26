import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assessExecution, type ExecutionPlan, type ReceiptObservation } from '../src/execution.ts';
import { appendExecutionRecord, readExecutionRecords } from '../src/execution-evidence.ts';

const account = '0x1111111111111111111111111111111111111111';
const pool = '0x2222222222222222222222222222222222222222';
const bank = '0x3333333333333333333333333333333333333333';
const plan: ExecutionPlan = { schema: 'perp-canary/plan/v1', tier: 'LIVE', observedAt: '2026-10-26T00:00:00Z',
  chainId: 50383, operation: 'PLACE', account, pool, marginBank: bank, symbol: 'BTC-PERP',
  baseline: { blockNumber: '10', positionSize: '0', feedGate: 'GREEN', markPrice: '100',
    consistency: 'SEQUENTIAL_READS_NOT_PINNED' },
  request: { isBid: true, price: '100', quantity: '10', orderId: null }, preview: null,
  blockers: [], warnings: [], method: 'placePerpOrder', sendEnabled: false };
const receipt: ReceiptObservation = { tier: 'LIVE', txHash: `0x${'a'.repeat(64)}`, chainId: 50383,
  status: 'success', from: account, to: pool,
  call: { method: 'placeOrder', isBid: true, price: '100', quantity: '10' },
  blockNumber: '11', gasUsed: '100', effectiveGasPrice: '1',
  placedOrderIds: ['42'], foreignOrderEvents: 0, cancelledOrderIds: [], fills: [], positionEvents: [], postPositionSize: '0', unknownLogs: 0 };

test('resting order and exact close have bounded GREEN verdicts with unknown fees', () => {
  const resting = assessExecution(plan, receipt);
  assert.equal(resting.verdict, 'GREEN');
  assert.equal(resting.actual.protocolFee, 'NOT_MEASURED');
  const close: ExecutionPlan = { ...plan, operation: 'CLOSE', baseline: { ...plan.baseline, positionSize: '10' },
    request: { isBid: false, price: '100', quantity: '10', orderId: null } };
  const filled: ReceiptObservation = { ...receipt, call: { method: 'placeOrder', isBid: false, price: '100', quantity: '10' },
    placedOrderIds: ['50'], fills: [{ quantity: '10', price: '100', takerOrderId: '50' }],
    positionEvents: [{ account, pool, newSize: '0' }], postPositionSize: '0' };
  assert.equal(assessExecution(close, filled).verdict, 'GREEN');
});

test('reverts, wrong target, overfill and limit breach are RED; stale baseline is AMBER', () => {
  assert.equal(assessExecution(plan, { ...receipt, status: 'reverted' }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, to: bank }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, fills: [{ quantity: '11', price: '100', takerOrderId: '1' }] }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, fills: [{ quantity: '5', price: '101', takerOrderId: '1' }] }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, fills: [{ quantity: '5', price: '100', takerOrderId: '1' }],
    positionEvents: [{ account, pool, newSize: '2' }] }).verdict, 'AMBER');
});

test('missing lifecycle event is AMBER and cancel requires matching order id', () => {
  assert.equal(assessExecution(plan, { ...receipt, placedOrderIds: [] }).verdict, 'AMBER');
  const cancel: ExecutionPlan = { ...plan, operation: 'CANCEL', method: 'cancelOrder',
    request: { isBid: null, price: null, quantity: null, orderId: '42' } };
  const cancelReceipt: ReceiptObservation = { ...receipt, call: { method: 'cancelOrder', orderId: '42' },
    placedOrderIds: [], cancelledOrderIds: ['42'] };
  assert.equal(assessExecution(cancel, cancelReceipt).verdict, 'GREEN');
  assert.equal(assessExecution(cancel, { ...cancelReceipt, cancelledOrderIds: ['43'] }).verdict, 'AMBER');
});

test('receipt attribution and timing fail conservatively', () => {
  const fill = { quantity: '3', price: '100', takerOrderId: '99' };
  assert.equal(assessExecution(plan, { ...receipt, fills: [fill], placedOrderIds: ['42'] }).verdict, 'AMBER');
  assert.equal(assessExecution(plan, { ...receipt, foreignOrderEvents: 1 }).verdict, 'AMBER');
  assert.equal(assessExecution(plan, { ...receipt, blockNumber: '9' }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, call: { method: 'placeOrder', isBid: true,
    price: '101', quantity: '10' } }).verdict, 'RED');
  assert.equal(assessExecution(plan, { ...receipt, call: null }).verdict, 'AMBER');
  assert.equal(assessExecution(plan, { ...receipt, fills: [{ ...fill, takerOrderId: '42' }],
    positionEvents: [{ account, pool, newSize: '3' }], postPositionSize: null }).verdict, 'AMBER');
});

test('execution evidence detects mutation and preserves previousHash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perp-canary-execution-'));
  const first = await appendExecutionRecord(dir, 'PLAN', plan);
  const second = await appendExecutionRecord(dir, 'RECONCILIATION', { planHash: first.hash, receipt });
  assert.equal(second.previousHash, first.hash);
  assert.equal((await readExecutionRecords(dir)).length, 2);
  const names = (await import('node:fs/promises')).readdir;
  const file = join(dir, (await names(dir)).sort()[0]!);
  await writeFile(file, (await readFile(file, 'utf8')).replace('BTC-PERP', 'ETH-PERP'));
  await assert.rejects(readExecutionRecords(dir), /chain invalid/);
});
