import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { keccak256, type Hex } from 'viem';
import { buildOrderActionPlan, orderActionData, verifyOrderActionPlan,
  type OrderActionObservation, type OrderSnapshot } from '../src/order-actions.ts';
import { assessOrderActionPreflight, executeOrderActionPlan,
  type OrderActionPorts } from '../src/order-action-execution.ts';
import { assessOrderAction } from '../src/order-action-forensics.ts';
import { assessCanary, assessPlanCanary } from '../src/canary-safety.ts';
import { readExecutionLedger } from '../src/execution-ledger.ts';
import { BTC_POOL, OWNER_TRADING_WALLET, type ForensicsBody } from '../src/trade-forensics.ts';

const BOT = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
const before = (): OrderSnapshot => ({ block: '34050000', id: '77', owner: OWNER_TRADING_WALLET,
  pool: BTC_POOL, side: 'BUY', priceRaw: '80000000000000000000000', fullRaw: '100000',
  remainingRaw: '80000', expiryNs: String((Date.now() + 3_600_000) * 1_000_000),
  active: true, positionRaw: '5416000', entryPriceRaw: '80043800000000000000000' });
function observation(changes: Partial<OrderActionObservation> = {}): OrderActionObservation {
  return { observedAt: new Date().toISOString(), chainId: 50383, owner: OWNER_TRADING_WALLET,
    operator: BOT, pool: BTC_POOL, snapshot: before(), gasWei: '5000000000000000000',
    permission: 'SUPPORTED', market: 'SUPPORTED', lotRaw: '1', minRaw: '13000',
    nowSeconds: String(Math.floor(Date.now() / 1000)), estimatedGas: '1000000',
    gasPriceWei: '6000000000', simulationFailure: null, ...changes };
}
const cancel = () => buildOrderActionPlan(observation(), 'CANCEL', '77', null);
const reduce = () => buildOrderActionPlan(observation(), 'REDUCE_ORDER', '77', '40000');
function source(plan: ReturnType<typeof cancel>, txHash: Hex, event = true,
  status = '0x1'): ForensicsBody {
  const blockHash = `0x${'cc'.repeat(32)}`;
  return { chainId: 50383, txHash,
    transaction: { hash: txHash, blockHash, from: BOT, to: BTC_POOL, input: plan.transaction!.data },
    receipt: { transactionHash: txHash, blockHash, from: BOT, to: BTC_POOL, status },
    decodedEvents: event ? [{ address: BTC_POOL, eventName: plan.operation === 'CANCEL' ?
      'OrderCancelled' : 'OrderReduced', args: { orderId: '77', newQuantity: '40000' } }] : [],
  } as unknown as ForensicsBody;
}
function ports(plan: ReturnType<typeof cancel>, changes: Partial<OrderActionPorts> = {}): OrderActionPorts {
  const raw = '0x02abcd' as Hex;
  return { fresh: async () => observation(), chainId: async () => 50383,
    nonce: async () => 4, gasPrice: async () => 6_000_000_000n,
    gasBalance: async () => 5_000_000_000_000_000_000n,
    estimateOriginal: async () => 1_000_000n, confirm: async () => true,
    sign: async () => raw, verifySigned: async () => true,
    broadcastOnce: async () => keccak256(raw),
    receiptAndForensics: async txHash => ({ source: source(plan, txHash),
      after: plan.operation === 'CANCEL' ? null : { ...before(), remainingRaw: '40000' } }),
    ...changes };
}
test('official CANCEL and REDUCE_ORDER calldata and plans validate', () => {
  const c = cancel(); const r = reduce();
  assert.equal(c.status, 'PREPARED'); assert.equal(r.status, 'PREPARED');
  assert.equal(c.transaction?.data.slice(0, 10), '0xe37b444b');
  assert.equal(r.transaction?.data.slice(0, 10), '0x364c2587');
  assert.equal(c.transaction?.data, orderActionData('CANCEL', OWNER_TRADING_WALLET, '77', null));
  assert.doesNotThrow(() => verifyOrderActionPlan(r));
  assert.throws(() => verifyOrderActionPlan({ ...r, newRemainingRaw: '90000' }), /integrity/);
});
test('missing, foreign, inactive, stale and wrong-pool orders never prepare', () => {
  for (const snapshot of [null, { ...before(), owner: BOT }, { ...before(), active: false },
    { ...before(), remainingRaw: '0' }, { ...before(), pool: BOT }])
    assert.equal(buildOrderActionPlan(observation({ snapshot }), 'CANCEL', '77', null).status, 'BLOCKED');
  assert.equal(buildOrderActionPlan(observation({ observedAt: new Date(Date.now() - 31_000).toISOString() }),
    'CANCEL', '77', null).status, 'BLOCKED');
});
test('reduce only shrinks a live resting order and cannot close or flip a position', () => {
  for (const quantity of ['0', '80000', '90000', '1'])
    assert.equal(buildOrderActionPlan(observation(), 'REDUCE_ORDER', '77', quantity).status, 'BLOCKED');
  assert.equal(buildOrderActionPlan(observation({ snapshot: { ...before(), expiryNs: '1' } }),
    'REDUCE_ORDER', '77', '40000').status, 'BLOCKED');
  assert.equal(reduce().before?.positionRaw, '5416000');
});
test('fresh permission, order state, position, nonce and gas must match before signing', () => {
  const plan = cancel();
  const base = { chainId: 50383, latestNonce: 4, pendingNonce: 4,
    gasPrice: 6_000_000_000n, gasBalance: 5_000_000_000_000_000_000n,
    simulatedGas: 1_000_000n, now: Date.now() };
  assert.equal(assessOrderActionPreflight(plan, observation({ snapshot: plan.before }), base).passed, true);
  for (const fresh of [observation({ permission: 'BLOCKED' }), observation({ snapshot: null }),
    observation({ snapshot: { ...plan.before!, remainingRaw: '70000' } }),
    observation({ snapshot: { ...plan.before!, positionRaw: '1' } })])
    assert.equal(assessOrderActionPreflight(plan, fresh, base).passed, false);
  for (const change of [{ chainId: 1 }, { pendingNonce: 5 }, { gasBalance: 0n },
    { now: Date.parse(plan.expiresAt) + 1 }])
    assert.equal(assessOrderActionPreflight(plan, observation({ snapshot: plan.before }),
      { ...base, ...change }).passed, false);
});
test('mock CANCEL executes once with verified event and no live signer or send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-order-'));
  const plan = cancel(); let sends = 0;
  try {
    const p = ports(plan, { fresh: async () => observation({ snapshot: plan.before }),
      broadcastOnce: async raw => { sends++; return keccak256(raw); } });
    const result = await executeOrderActionPlan(plan, p,
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(result.state, 'VERIFIED'); assert.equal(sends, 1);
    await assert.rejects(executeOrderActionPlan(plan, p,
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') }), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('mock REDUCE_ORDER verifies exact remaining quantity and preserves position', () => {
  const p = reduce();
  const tx = `0x${'aa'.repeat(32)}` as Hex;
  assert.equal(assessOrderAction(p, source(p, tx), { ...p.before!, remainingRaw: '40000' }).verdict, 'VERIFIED');
  assert.equal(assessOrderAction(p, source(p, tx), { ...p.before!, remainingRaw: '50000' }).verdict, 'RED');
  assert.equal(assessOrderAction(p, source(p, tx), { ...p.before!, remainingRaw: '40000', positionRaw: '0' }).verdict, 'AMBER');
});
test('reverted receipt, missing event and active cancelled order cannot be VERIFIED', () => {
  const p = cancel(); const tx = `0x${'bb'.repeat(32)}` as Hex;
  assert.equal(assessOrderAction(p, source(p, tx, true, '0x0'), null).verdict, 'RED');
  assert.equal(assessOrderAction(p, source(p, tx, false), null).verdict, 'AMBER');
  assert.equal(assessOrderAction(p, source(p, tx), p.before).verdict, 'RED');
});
test('broadcast timeout remains UNKNOWN with one attempt and durable signed hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-order-'));
  const plan = cancel(); let sends = 0;
  try {
    const p = ports(plan, { fresh: async () => observation({ snapshot: plan.before }),
      broadcastOnce: async () => { sends++; throw Error('timeout'); } });
    const result = await executeOrderActionPlan(plan, p,
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(result.state, 'UNKNOWN'); assert.equal(sends, 1);
    assert.equal((await readExecutionLedger(join(dir, 'ledger'), plan.intentId)).at(-1)?.state, 'BROADCAST_UNKNOWN');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Canary Safety Engine distinguishes red, amber and proven green without replacing gates', () => {
  assert.equal(assessCanary(['IOC_NO_FILL', 'INSUFFICIENT_GAS'], 'REPLAYED').verdict, 'RED');
  assert.equal(assessCanary(['EXECUTION_UNCERTAIN'], 'SIMULATED').verdict, 'AMBER');
  assert.equal(assessCanary([], 'LIVE_READ_ONLY').verdict, 'GREEN');
  const cascade = assessPlanCanary({ status: 'BLOCKED',
    checks: { chain: false, gas: false, simulation: false, fresh: false },
    diagnostic: { primaryError: 'ImmediateOrCancelNoFill()',
      blockedDependencies: ['chain', 'gas', 'simulation', 'fresh'] } });
  assert.equal(cascade.primary, 'IOC_NO_FILL');
  assert.deepEqual(cascade.dependent, []);
});
