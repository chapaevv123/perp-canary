import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeFunctionData, keccak256, parseUnits, type Hex } from 'viem';
import { buildPreparedPlan, PLACE_ABI, positionEffect, verifyPreparedPlan } from '../src/delegated-plan.ts';
import { appendBotPlanEvidence, readBotPlanEvidence } from '../src/bot-evidence.ts';
import { assessExecutionPreflight, assertExecutionMarketIntegrity, checkDelegatedPlan, ExecutionStageError,
  executeDelegatedPlan, type ExecutionPorts } from '../src/delegated-execution.ts';
import { decodeExecutionError } from '../src/execution-error-decoder.ts';
import { assessDelegatedTrade, readForensicEvidence, saveForensicEvidence } from '../src/delegated-forensics.ts';
import { appendExecutionState, readAllExecutionLedgers, readExecutionLedger, reserveIntent } from '../src/execution-ledger.ts';
import { BTC_POOL, OWNER_TRADING_WALLET, type ForensicsBody } from '../src/trade-forensics.ts';
import { signedFieldsMatch } from '../src/signed-transaction.ts';
import { classifySimulationFailure } from '../src/preflight-failure.ts';
import { RPC } from '../src/rpc-health.ts';
import { BOOK_SOURCE } from '../src/market-integrity.ts';
import { sha256 } from '../src/evidence.ts';
import type { inspectTradingAuthorization } from '../src/trading-authorization.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
const BOT = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
const input = { side: 'BUY' as const, price: '80000', quantity: '0.001' };
function observation(changes: Record<string, unknown> = {},
  order: { side: 'BUY' | 'SELL'; price: string; quantity: string } = input): Observation {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const data = encodeFunctionData({ abi: PLACE_ABI, functionName: 'placeOrderFor',
    args: [OWNER_TRADING_WALLET, order.side === 'BUY', 0n, parseUnits(order.price, 18),
      parseUnits(order.quantity, 8), BigInt(Date.parse(expiresAt)) * 1_000_000n,
      2, 0, '0x0000000000000000000000000000000000000000', 0n] });
  return { observedAt: new Date().toISOString(), chainId: 50383, sampledBlock: '34017211',
    tradingWallet: OWNER_TRADING_WALLET, candidateOperator: BOT, pool: BTC_POOL, market: 'BTC-PERP',
    marketSupported: { status: 'SUPPORTED' }, registryMatches: { status: 'SUPPORTED' },
    permissions: { place: { effective: { status: 'SUPPORTED' } } }, marginSufficient: true,
    marginBankUnlocked: '1000', operatorGasStt: '5', markPriceRaw: parseUnits('80000', 18).toString(),
    positionSizeRaw: '0', estimatedGasUnits: '2000000', gasPriceWei: '6000000000',
    bookTops: { market: 'BTC-PERP', pool: BTC_POOL, source: BOOK_SOURCE, rpcUrl: RPC,
      blockNumber: '34017211', blockHash: `0x${'ab'.repeat(32)}`,
      postReadBlockHash: `0x${'ab'.repeat(32)}`,
      blockTimestamp: new Date().toISOString(), observedAt: new Date().toISOString(),
      quoteDecimals: 18, tickSizeRaw: parseUnits('0.1', 18).toString(),
      bestBidRaw: parseUnits('79999', 18).toString(),
      bestAskRaw: parseUnits('80000', 18).toString(),
      directBestBidRaw: parseUnits('79999', 18).toString(),
      directBestAskRaw: parseUnits('80000', 18).toString() },
    planBlockers: [], simulation: { status: 'SUPPORTED' },
    unsigned: { chainId: 50383, from: BOT, to: BTC_POOL, value: '0', data, expiresAt },
    ...changes } as unknown as Observation;
}
const plan = () => buildPreparedPlan(observation(), input);
function evidence(p: ReturnType<typeof plan>, options: { filled?: string; position?: string;
  receiptStatus?: string; noFill?: boolean; txHash?: string } = {}): ForensicsBody {
  const qty = options.filled ?? parseUnits(p.quantity, 8).toString();
  const events: Array<Record<string, unknown>> = [{ eventName: 'OrderPlaced', address: p.pool,
    args: { orderId: '7', placedOrder: { owner: p.owner, fullQuantity: parseUnits(p.quantity, 8).toString(),
      price: parseUnits(p.price, 18).toString(), isBid: p.side === 'BUY' } } }];
  if (!options.noFill) events.push({ eventName: 'OrderFilled', address: p.pool,
    args: { takerOrderId: '7', quantityFilled: qty, fillPrice: parseUnits(p.price, 18).toString() } });
  if (!options.noFill) events.push({ eventName: 'PositionUpdated', address: p.pool,
    args: { account: p.owner, perpPool: p.pool, newSize: options.position ?? qty } });
  const txHash = options.txHash ?? `0x${'ab'.repeat(32)}`;
  const blockHash = `0x${'cd'.repeat(32)}`;
  return { txHash, chainId: 50383,
    transaction: { hash: txHash, blockHash, from: p.operator, to: p.pool, input: p.transaction!.data },
    receipt: { transactionHash: txHash, blockHash, status: options.receiptStatus ?? '0x1',
      from: p.operator, to: p.pool },
    marketIdentity: { status: 'VERIFIED' }, decodedEvents: events } as unknown as ForensicsBody;
}
function ports(p: ReturnType<typeof plan>, changes: Partial<ExecutionPorts> = {}): ExecutionPorts {
  const raw = '0x02abcd' as Hex;
  return { fresh: async () => observation(), chainId: async () => 50383,
    nonce: async () => 4, gasPrice: async () => 6_000_000_000n,
    gasBalance: async () => parseUnits('5', 18), estimateOriginal: async () => 2_000_000n,
    confirm: async () => true, sign: async () => raw,
    verifySigned: async () => true,
    broadcastOnce: async () => keccak256(raw),
    receiptAndForensics: async hash => ({ body: evidence(p, { txHash: hash }),
      currentPositionRaw: parseUnits(p.quantity, 8).toString() }), ...changes };
}

test('valid official BTC-PERP calldata yields an immutable prepared plan', () => {
  const p = plan();
  assert.equal(p.status, 'PREPARED');
  assert.equal(p.risk.orderNotionalWei, parseUnits('80', 18).toString());
  assert.doesNotThrow(() => verifyPreparedPlan(p));
  assert.throws(() => verifyPreparedPlan({ ...p, price: '1' }), /integrity/);
  assert.throws(() => verifyPreparedPlan({ ...p, pool: BOT }), /integrity/);
});
test('unauthorized, revoked, wrong chain, market, margin, gas, simulation and oversize are blocked', () => {
  const denied = { permissions: { place: { effective: { status: 'BLOCKED' } } } };
  for (const change of [denied, { chainId: 1 }, { market: 'ETH-PERP' },
    { marginSufficient: false }, { operatorGasStt: '0' }, { simulation: { status: 'BLOCKED' } },
    { planBlockers: ['SDK maximum placeable size unavailable or exceeded'] }])
    assert.equal(buildPreparedPlan(observation(change), input).status, 'BLOCKED');
  const big = { ...input, quantity: '0.01' };
  assert.equal(buildPreparedPlan(observation({}, big), big).status, 'BLOCKED');
});
test('IOC no-fill revert is primary; absent unsigned transaction explains dependent failed gates', () => {
  const failure = classifySimulationFailure({ cause: { cause: { code: 3,
    data: '0xd48c4403', details: 'execution reverted' } } });
  assert.equal(failure.category, 'CONTRACT_REVERT');
  assert.equal(failure.contractError, 'ImmediateOrCancelNoFill()');
  const p = buildPreparedPlan(observation({ unsigned: null, estimatedGasUnits: 'UNKNOWN',
    gasPriceWei: 'UNKNOWN', simulation: { status: 'BLOCKED' },
    simulationFailure: { ...failure, bestAsk: '80024.9' },
    planBlockers: ['Read-only eth_estimateGas simulation failed'] }), input);
  assert.equal(p.status, 'BLOCKED');
  assert.equal(p.checks.market, true);
  assert.equal(p.checks.permission, true);
  assert.equal(p.checks.margin, true);
  assert.equal(p.diagnostic?.primaryError, 'ImmediateOrCancelNoFill()');
  assert.deepEqual(p.diagnostic?.blockedDependencies, ['chain', 'gas', 'simulation', 'fresh', 'targetAndCalldata']);
  assert.equal(p.diagnostic?.failure.bestAsk, '80024.9');
  assert.doesNotThrow(() => verifyPreparedPlan(p));
});
test('non-contract RPC failure is not mislabelled as IOC no-fill', () => {
  const failure = classifySimulationFailure({ cause: { code: -32000, details: 'upstream unavailable' } });
  assert.equal(failure.category, 'RPC_FAILURE');
  assert.equal(failure.contractError, null);
  assert.equal(failure.selector, null);
});
test('stale, expired, wrong nonce, calldata, gas and mark changes block Phase B', () => {
  const p = plan();
  const base = { chainId: 50383, latestNonce: 4, pendingNonce: 4, gasPrice: 6_000_000_000n,
    gasBalance: parseUnits('5', 18), simulatedGas: 2_000_000n, now: Date.now() };
  const freshBase = observation();
  const baseline = assessExecutionPreflight(p, freshBase, { ...base, now: Date.now() });
  assert.equal(baseline.passed, true, baseline.blockers.join('; '));
  for (const change of [{ chainId: 5031 }, { pendingNonce: 5 }, { gasBalance: 0n },
    { simulatedGas: 20_000_000n }, { now: Date.parse(p.expiresAt) + 1 }])
    assert.equal(assessExecutionPreflight(p, observation(), { ...base, ...change }).passed, false);
  assert.equal(assessExecutionPreflight(p, observation({ markPriceRaw: parseUnits('82000', 18).toString() }), base).passed, false);
  assert.equal(assessExecutionPreflight(p, observation({ positionSizeRaw: '1' }), base).passed, false);
  assert.equal(assessExecutionPreflight(p, observation({ unsigned: { ...observation().unsigned,
    to: BOT } }), base).passed, false);
  assert.equal(assessExecutionPreflight(p, observation({ observedAt: new Date(Date.now() - 31_000).toISOString() }), base).passed, false);
});
test('signed transaction fields reject mainnet, wrong target, signer and nonce', () => {
  const p = plan();
  const expected = { type: 'legacy' as const, chainId: 50383, to: BTC_POOL as `0x${string}`,
    data: p.transaction!.data, value: 0n, gas: BigInt(p.risk.gasLimit), gasPrice: 6_000_000_000n,
    nonce: 4 };
  const actual = { ...expected };
  assert.equal(signedFieldsMatch(actual, expected, BOT, BOT), true);
  assert.equal(signedFieldsMatch({ ...actual, chainId: 5031 }, expected, BOT, BOT), false);
  assert.equal(signedFieldsMatch({ ...actual, to: BOT }, expected, BOT, BOT), false);
  assert.equal(signedFieldsMatch(actual, expected, BOT, OWNER_TRADING_WALLET), false);
  assert.equal(signedFieldsMatch({ ...actual, nonce: 5 }, expected, BOT, BOT), false);
});
test('durable reservation is exclusive and terminal states cannot be duplicated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-intent-'));
  const p = plan();
  try {
    await reserveIntent(dir, p.intentId, p.hash);
    await assert.rejects(reserveIntent(dir, p.intentId, p.hash), /EEXIST/);
    await appendExecutionState(dir, p.intentId, p.hash, 'SIGNED', `0x${'11'.repeat(32)}`);
    await appendExecutionState(dir, p.intentId, p.hash, 'BROADCAST_ACCEPTED', `0x${'11'.repeat(32)}`);
    await appendExecutionState(dir, p.intentId, p.hash, 'VERIFIED', `0x${'11'.repeat(32)}`);
    await assert.rejects(appendExecutionState(dir, p.intentId, p.hash, 'VERIFIED', `0x${'11'.repeat(32)}`), /transition/);
    assert.equal((await readExecutionLedger(dir, p.intentId)).length, 4);
    assert.equal((await readAllExecutionLedgers(dir)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('SIGNED reservation can be manually reconciled after an uncertain send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-unknown-'));
  const p = plan();
  try {
    await reserveIntent(dir, p.intentId, p.hash);
    const hash = `0x${'11'.repeat(32)}`;
    await appendExecutionState(dir, p.intentId, p.hash, 'SIGNED', hash);
    await appendExecutionState(dir, p.intentId, p.hash, 'VERIFIED', hash);
    await assert.rejects(appendExecutionState(dir, p.intentId, p.hash, 'AMBER', hash), /transition/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('mocked local confirmation executes once; no real key or RPC send is used', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-exec-'));
  const p = plan();
  let sends = 0;
  try {
    const outcome = await executeDelegatedPlan(p, ports(p, { broadcastOnce: async raw => { sends++; return keccak256(raw); } }),
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(outcome.state, 'VERIFIED');
    assert.equal(sends, 1);
    await assert.rejects(executeDelegatedPlan(p, ports(p),
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') }), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('cancelled confirmation and signer failure never broadcast', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-exec-'));
  const p = plan();
  try {
    assert.equal((await executeDelegatedPlan(p, ports(p, { confirm: async () => false }),
      { ledger: join(dir, 'cancelled'), forensics: join(dir, 'forensics') })).state, 'CANCELLED');
    assert.equal((await executeDelegatedPlan(p, ports(p, { sign: async () => { throw Error('wrong password'); } }),
      { ledger: join(dir, 'failed'), forensics: join(dir, 'forensics') })).state, 'BLOCKED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('broadcast timeout is UNKNOWN and never automatically retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-exec-'));
  const p = plan();
  let sends = 0;
  try {
    const result = await executeDelegatedPlan(p, ports(p, { broadcastOnce: async () => { sends++; throw Error('timeout'); } }),
      { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(result.state, 'UNKNOWN'); assert.equal(sends, 1);
    assert.equal((await readExecutionLedger(join(dir, 'ledger'), p.intentId)).at(-1)?.state, 'BROADCAST_UNKNOWN');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('receipt forensics separates revert, partial, missing fill and position mismatch', () => {
  const p = plan();
  assert.equal(assessDelegatedTrade(p, evidence(p, { receiptStatus: '0x0' }), '100000').verdict, 'RED');
  assert.equal(assessDelegatedTrade(p, evidence(p, { filled: '50000', position: '50000' }), '50000').verdict, 'AMBER');
  assert.equal(assessDelegatedTrade(p, evidence(p, { noFill: true }), '0').verdict, 'AMBER');
  assert.equal(assessDelegatedTrade(p, evidence(p, { position: '999' }), '999').verdict, 'RED');
  assert.equal(assessDelegatedTrade(p, evidence(p), '100000').verdict, 'VERIFIED');
  assert.equal(assessDelegatedTrade(p, { ...evidence(p), chainId: 1 }, '100000').verdict, 'RED');
});
test('forensic artifact stores reproducible source and detects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-forensic-'));
  try {
    const p = plan();
    const record = assessDelegatedTrade(p, evidence(p), '100000');
    await saveForensicEvidence(dir, record);
    assert.equal((await readForensicEvidence(dir))[0]?.sourceHash, record.sourceHash);
    const file = join(dir, `${record.txHash.toLowerCase()}.json`);
    const changed = JSON.parse(await readFile(file, 'utf8'));
    changed.source.chainId = 1;
    await writeFile(file, JSON.stringify(changed));
    await assert.rejects(readForensicEvidence(dir), /invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('existing LONG is included in full-fill effect and opposite-side PLACE is blocked', () => {
  const before = parseUnits('0.05416', 8).toString();
  const p = buildPreparedPlan(observation({ positionSizeRaw: before }), input);
  assert.equal(p.status, 'PREPARED');
  assert.deepEqual(positionEffect('BUY', p.quantity, before), {
    kind: 'INCREASE_LONG', afterFullFillRaw: parseUnits('0.05516', 8).toString(),
  });
  const after = parseUnits('0.05516', 8).toString();
  assert.equal(assessDelegatedTrade(p, evidence(p, { position: after }), after).verdict, 'VERIFIED');
  const sell = { side: 'SELL' as const, price: input.price, quantity: input.quantity };
  const opposite = buildPreparedPlan(observation({ positionSizeRaw: before }, sell), sell);
  assert.equal(opposite.status, 'BLOCKED');
  assert.match(opposite.blockers.join(' '), /could reduce or flip/);
});

test('read-only dry run loads exact plan hash and stops before signing or broadcast', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-m35-dry-'));
  const p = buildPreparedPlan(observation({ positionSizeRaw: parseUnits('0.05416', 8).toString() }), input);
  let signed = 0;
  let sent = 0;
  try {
    await appendBotPlanEvidence(join(dir, 'plans'), p);
    const loaded = (await readBotPlanEvidence(join(dir, 'plans')))[0]?.plan;
    assert.equal(loaded?.hash, p.hash);
    assert.equal(loaded?.schema, 'perp-canary/delegated-plan/v2');
    if (loaded?.schema !== 'perp-canary/delegated-plan/v2') throw Error('Wrong plan schema');
    assert.equal(loaded.transaction?.data, p.transaction?.data);
    assert.equal(loaded.owner, OWNER_TRADING_WALLET);
    assert.equal(loaded.operator, BOT);
    assert.equal(loaded.chainId, 50383);
    assert.equal(loaded.pool.toLowerCase(), BTC_POOL.toLowerCase());
    assert.equal(loaded.risk.gasLimit, p.risk.gasLimit);
    const mock = ports(loaded, { fresh: async () => observation({ positionSizeRaw: loaded.positionSizeBeforeRaw }),
      confirm: async () => false,
      sign: async () => { signed++; throw Error('dry run must not sign'); },
      broadcastOnce: async () => { sent++; throw Error('dry run must not broadcast'); } });
    const outcome = await executeDelegatedPlan(loaded, mock, {
      ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics'),
    });
    assert.equal(outcome.state, 'CANCELLED');
    assert.equal(signed, 0);
    assert.equal(sent, 0);
    assert.deepEqual(await readExecutionLedger(join(dir, 'ledger'), p.intentId), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('forensics cannot verify absent events or unexplained position changes', () => {
  const p = plan();
  const missing = { ...evidence(p), decodedEvents: [] };
  assert.equal(assessDelegatedTrade(p, missing, '0').verdict, 'AMBER');
  assert.equal(assessDelegatedTrade(p, missing, '100000').verdict, 'RED');
  assert.equal(assessDelegatedTrade(p, evidence(p, { noFill: true }), '1').verdict, 'RED');
  const priced = evidence(p);
  (priced.decodedEvents[0]?.args.placedOrder as Record<string, unknown>).price = '1';
  assert.equal(assessDelegatedTrade(p, priced, '100000').verdict, 'RED');
});

test('receipt RPC timeout leaves UNKNOWN and the intent reserved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-m35-timeout-'));
  const p = plan();
  try {
    const result = await executeDelegatedPlan(p, ports(p, {
      receiptAndForensics: async () => { throw Error('RPC timeout'); },
    }), { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(result.state, 'UNKNOWN');
    assert.equal((await readExecutionLedger(join(dir, 'ledger'), p.intentId)).at(-1)?.state, 'BROADCAST_ACCEPTED');
    await assert.rejects(reserveIntent(join(dir, 'ledger'), p.intentId, p.hash), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('browser PREPARED and CLI original-calldata IOC revert stays pre-broadcast', async () => {
  const p = plan();
  assert.equal(p.status, 'PREPARED');
  const failure = { cause: { code: 3, data: '0xd48c4403', message: 'execution reverted' } };
  await assert.rejects(checkDelegatedPlan(p, ports(p, {
    estimateOriginal: async () => { throw failure; },
    sign: async () => { throw Error('sign must not run'); },
    broadcastOnce: async () => { throw Error('send must not run'); },
  })), error => {
    assert.ok(error instanceof ExecutionStageError);
    assert.equal(error.stage, 'ESTIMATE_GAS');
    const decoded = decodeExecutionError(error.original, error.stage);
    assert.equal(decoded.reason, 'IOC_NO_FILL');
    assert.equal(decoded.contractError, 'ImmediateOrCancelNoFill()');
    assert.equal(decoded.transactionSent, 'NO');
    return true;
  });
});

test('read-only preflight detects sender, RPC chain, calldata and changed ask', () => {
  const p = plan();
  const base = { chainId: 50383, latestNonce: 0, pendingNonce: 0,
    gasPrice: 6_000_000_000n, gasBalance: parseUnits('5', 18),
    simulatedGas: 2_000_000n, now: Date.now() };
  const sender = observation({ unsigned: { ...observation().unsigned, from: OWNER_TRADING_WALLET } });
  assert.match(assessExecutionPreflight(p, sender, base).blockers.join(' '), /calldata mismatch/);
  assert.match(assessExecutionPreflight(p, observation(), { ...base, chainId: 50312 }).blockers.join(' '), /Wrong chain/);
  const pinned = buildPreparedPlan(observation({ rpcUrl: RPC }), input);
  const changedRpc = observation({ rpcUrl: 'https://different.invalid' });
  assert.match(assessExecutionPreflight(pinned, changedRpc, base).blockers.join(' '), /RPC endpoint changed/);
  const data = observation().unsigned!.data.replace(/.$/, '1') as Hex;
  const calldata = observation({ unsigned: { ...observation().unsigned, data } });
  assert.match(assessExecutionPreflight(p, calldata, base).blockers.join(' '), /calldata mismatch/);
  const book = observation({ bookTops: { ...observation().bookTops,
    bestBidRaw: parseUnits('79999', 18).toString(),
    bestAskRaw: parseUnits('80001', 18).toString(),
    directBestBidRaw: parseUnits('79999', 18).toString(),
    directBestAskRaw: parseUnits('80001', 18).toString() } });
  assert.match(assessExecutionPreflight(p, book, base).blockers.join(' '), /below current best ask/);
});

test('IOC preparation, check and final pre-sign all reject a crossed pinned book', async () => {
  const crossed = observation({ bookTops: { ...observation().bookTops,
    bestBidRaw: parseUnits('80010', 18).toString(),
    bestAskRaw: parseUnits('80000', 18).toString(),
    directBestBidRaw: parseUnits('80010', 18).toString(),
    directBestAskRaw: parseUnits('80000', 18).toString() } });
  assert.equal(buildPreparedPlan(crossed, input).status, 'BLOCKED');
  const p = plan();
  assert.throws(() => assertExecutionMarketIntegrity(p, crossed), /Read-only execution check failed/);
  let estimateCalled = false;
  await assert.rejects(checkDelegatedPlan(p, { ...ports(p), fresh: async () => crossed,
    estimateOriginal: async () => { estimateCalled = true; return 2_000_000n; } }),
  error => error instanceof ExecutionStageError &&
    (error.original as Error).message.includes('CROSSED_BOOK'));
  assert.equal(estimateCalled, false);
});

test('a previously PREPARED plan without integrity provenance cannot bypass the hotfix', async () => {
  const current = plan();
  const { hash: originalHash, ...body } = current;
  assert.equal(originalHash, current.hash);
  const oldBody = { ...body, bookTops: { blockNumber: current.sampledBlock,
    bestBidRaw: parseUnits('79999', 18).toString(),
    bestAskRaw: parseUnits('80000', 18).toString() } };
  const old = { ...oldBody, hash: sha256(oldBody) };
  assert.doesNotThrow(() => verifyPreparedPlan(old));
  await assert.rejects(checkDelegatedPlan(old, ports(old)), error =>
    error instanceof ExecutionStageError &&
    (error.original as Error).message.includes('MISSING_FRESHNESS_METADATA'));
});

test('signing failure records terminal pre-broadcast state without a fake tx hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-m36-presend-'));
  const p = plan();
  try {
    const result = await executeDelegatedPlan(p, ports(p, {
      sign: async () => { throw Error('fixture signer failure'); },
      broadcastOnce: async () => { throw Error('must not broadcast'); },
    }), { ledger: join(dir, 'ledger'), forensics: join(dir, 'forensics') });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.txHash, null);
    const history = await readExecutionLedger(join(dir, 'ledger'), p.intentId);
    assert.equal(history.at(-1)?.state, 'BLOCKED_PRE_BROADCAST');
    assert.equal(history.at(-1)?.txHash, null);
    await assert.rejects(reserveIntent(join(dir, 'ledger'), p.intentId, p.hash), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
