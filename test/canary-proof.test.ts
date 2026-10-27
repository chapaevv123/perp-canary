import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseUnits } from 'viem';
import { orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import { buildPreparedPlan, PLACE_ABI, verifyPreparedPlan } from '../src/delegated-plan.ts';
import { assessExecutionPreflight, checkDelegatedPlan, executeDelegatedPlan,
  type ExecutionPorts } from '../src/delegated-execution.ts';
import { buildCanaryProof, classifyCanaryEvents, validateCanaryProof, verifyCanaryProof,
  type ProofSnapshot } from '../src/canary-proof.ts';
import { decodeExecutionError } from '../src/execution-error-decoder.ts';
import { BTC_POOL, HIDEKI_MARGIN_BANK, OWNER_TRADING_WALLET, type RawLog } from '../src/trade-forensics.ts';
import type { inspectTradingAuthorization } from '../src/trading-authorization.ts';
import { BOOK_SOURCE } from '../src/market-integrity.ts';
import { RPC } from '../src/rpc-health.ts';

const BOT = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
const input = { side: 'BUY' as const, price: '79990', quantity: '0.00013', executionMode: 'POST_ONLY' as const };
function fixture(changes: Record<string, unknown> = {}) {
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const data = encodeFunctionData({ abi: PLACE_ABI, functionName: 'placeOrderFor',
    args: [OWNER_TRADING_WALLET, true, 0n, parseUnits(input.price, 18),
      parseUnits(input.quantity, 8), BigInt(Date.parse(expiresAt)) * 1_000_000n,
      3, 0, '0x0000000000000000000000000000000000000000', 0n] });
  return { observedAt, chainId: 50383, sampledBlock: '123', rpcUrl: 'https://api.hideki2.infra.testnet.somnia.network',
    tradingWallet: OWNER_TRADING_WALLET, candidateOperator: BOT, pool: BTC_POOL, market: 'BTC-PERP',
    marketSupported: { status: 'SUPPORTED' }, registryMatches: { status: 'SUPPORTED' },
    permissions: { place: { effective: { status: 'SUPPORTED' } } }, marginSufficient: true,
    marginBankUnlocked: '1000', operatorGasStt: '5', markPriceRaw: parseUnits('80000', 18).toString(),
    positionSizeRaw: '5416000', estimatedGasUnits: '2000000', gasPriceWei: '6000000000',
    bookTops: { market: 'BTC-PERP', pool: BTC_POOL, source: BOOK_SOURCE, rpcUrl: RPC,
      blockNumber: '123', blockHash: `0x${'ab'.repeat(32)}`,
      postReadBlockHash: `0x${'ab'.repeat(32)}`,
      blockTimestamp: observedAt, observedAt, quoteDecimals: 18,
      tickSizeRaw: parseUnits('0.1', 18).toString(),
      bestBidRaw: parseUnits('79980', 18).toString(),
      bestAskRaw: parseUnits('80010', 18).toString(),
      directBestBidRaw: parseUnits('79980', 18).toString(),
      directBestAskRaw: parseUnits('80010', 18).toString() },
    planBlockers: [], simulation: { status: 'SUPPORTED' },
    unsigned: { chainId: 50383, from: BOT, to: BTC_POOL, value: '0', data, expiresAt },
    ...changes } as unknown as Awaited<ReturnType<typeof inspectTradingAuthorization>>;
}
const plan = () => buildPreparedPlan(fixture(), input);
const txHash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
function log(name: 'OrderPlaced' | 'OrderRested', index: number): RawLog {
  const topics = encodeEventTopics({ abi: orderBookEventsAbi, eventName: name, args: { orderId: 7n } });
  const placed = orderBookEventsAbi.find(item => item.name === 'OrderPlaced')!;
  const data = name === 'OrderPlaced' ? encodeAbiParameters([placed.inputs[1]!], [{ orderId: 7n,
    isBid: true, owner: OWNER_TRADING_WALLET, userData: 0n, price: parseUnits(input.price, 18),
    fullQuantity: parseUnits(input.quantity, 8), quantityRemaining: parseUnits(input.quantity, 8),
    expireTimestampNs: 9999999999999999n }]) : '0x';
  return { address: BTC_POOL, topics: topics.flat().filter((value): value is `0x${string}` =>
    typeof value === 'string'), data, logIndex: `0x${index.toString(16)}`,
    transactionHash: txHash };
}
function snapshot(p = plan(), status = '0x1', logs: RawLog[] = []): ProofSnapshot {
  return { chainId: 50383, transaction: { hash: txHash, from: BOT, to: BTC_POOL,
    input: p.transaction!.data, value: '0', nonce: 0, gas: p.risk.gasLimit,
    gasPrice: p.risk.gasPriceWei, blockHash, blockNumber: '456' },
  receipt: { transactionHash: txHash, blockHash, blockNumber: '456', status,
    from: BOT, to: BTC_POOL, gasUsed: '2000000', effectiveGasPrice: p.risk.gasPriceWei, logs } };
}
function signedLedger(p = plan()) {
  return [{ planHash: p.hash, intentId: p.intentId, state: 'SIGNED' as const, txHash,
    hash: 'ledger-hash' }] as unknown as Parameters<typeof buildCanaryProof>[1];
}

test('official PostOnly calldata and nonmarketable book produce a bounded plan', () => {
  const p = plan();
  assert.equal(p.status, 'PREPARED');
  assert.equal(p.executionMode, 'POST_ONLY');
  assert.ok(BigInt(p.risk.maxGasCostWei) <= 100_000_000_000_000_000n);
  assert.doesNotThrow(() => verifyPreparedPlan(p));
  assert.throws(() => verifyPreparedPlan({ ...p, executionMode: undefined }), /integrity/);
  assert.equal(buildPreparedPlan(fixture({ bookTops: { blockNumber: '123',
    bestBidRaw: parseUnits('79980', 18).toString(), bestAskRaw: parseUnits('79990', 18).toString() } }), input).status, 'BLOCKED');
  assert.equal(buildPreparedPlan(fixture({ bookTops: { blockNumber: '122',
    bestBidRaw: parseUnits('79980', 18).toString(), bestAskRaw: parseUnits('80010', 18).toString() } }), input).status, 'BLOCKED');
  assert.equal(buildPreparedPlan(fixture({ permissions: { place: { effective: { status: 'BLOCKED' } } } }), input).status, 'BLOCKED');
  assert.equal(buildPreparedPlan(fixture({ estimatedGasUnits: '10000000' }), input).status, 'BLOCKED');
  assert.equal(buildPreparedPlan(fixture({ gasPriceWei: '50000000000' }), input).status, 'BLOCKED');
});

test('PostOnly recheck blocks crossing, stale book, expiry and nonce conflict', () => {
  const p = plan();
  const base = { chainId: 50383, latestNonce: 0, pendingNonce: 0, gasPrice: 6_000_000_000n,
    gasBalance: parseUnits('5', 18), simulatedGas: 2_000_000n, now: Date.now() };
  assert.equal(assessExecutionPreflight(p, fixture(), base).passed, true);
  assert.equal(assessExecutionPreflight(p, fixture({ bookTops: { blockNumber: '123',
    bestBidRaw: parseUnits('79980', 18).toString(), bestAskRaw: parseUnits(input.price, 18).toString() } }), base).passed, false);
  assert.equal(assessExecutionPreflight(p, fixture({ bookTops: { blockNumber: '122',
    bestBidRaw: parseUnits('79980', 18).toString(), bestAskRaw: parseUnits('80010', 18).toString() } }), base).passed, false);
  assert.equal(assessExecutionPreflight(p, fixture(), { ...base, pendingNonce: 1 }).passed, false);
  assert.equal(assessExecutionPreflight(p, fixture(), { ...base, now: Date.parse(p.expiresAt) }).passed, false);
});

test('changed book between preparation, check and execution blocks before sign or send', async () => {
  const p = plan();
  const raw = (value: string) => parseUnits(value, 18).toString();
  const crossed = fixture({ bookTops: { ...fixture().bookTops,
    bestBidRaw: raw('80020'), bestAskRaw: raw('80010'),
    directBestBidRaw: raw('80020'), directBestAskRaw: raw('80010') } });
  const readOnly = { fresh: async () => crossed, chainId: async () => 50383,
    nonce: async () => 0, gasPrice: async () => 6_000_000_000n,
    gasBalance: async () => parseUnits('5', 18), estimateOriginal: async () => 2_000_000n };
  await assert.rejects(checkDelegatedPlan(p, readOnly), /Read-only execution check failed at PREFLIGHT/);
  let reads = 0;
  let signed = 0;
  let sent = 0;
  const ports: ExecutionPorts = { ...readOnly,
    fresh: async () => ++reads === 1 ? fixture() : crossed,
    confirm: async () => true,
    sign: async () => { signed++; throw Error('must not sign'); },
    verifySigned: async () => false,
    broadcastOnce: async () => { sent++; throw Error('must not send'); },
    receiptAndForensics: async () => null };
  await assert.rejects(executeDelegatedPlan(p, ports,
    { ledger: 'not-used-ledger', forensics: 'not-used-forensics' }), error =>
    error instanceof Error && 'original' in error &&
    (error.original as Error).message.includes('CROSSED_BOOK'));
  assert.equal(reads, 2);
  assert.equal(signed, 0);
  assert.equal(sent, 0);
});

test('proof hash detects tampering and PREPARED does not claim independent execution', async () => {
  const p = plan();
  const proof = buildCanaryProof(p, []);
  assert.doesNotThrow(() => validateCanaryProof(proof));
  assert.throws(() => validateCanaryProof({ ...proof, plan: { ...p, price: '1' } }), /SHA-256/);
  const verdict = await verifyCanaryProof(proof, { snapshot: async () => { throw Error('Must not read'); } });
  assert.equal(verdict.verdict, 'PARTIALLY_VERIFIED');
  assert.equal(verdict.independentChainRead, false);
});

test('independent receipt and official rest event verify placement, not a fill', async () => {
  const p = plan();
  const live = snapshot(p, '0x1', [log('OrderPlaced', 0), log('OrderRested', 1)]);
  const proof = buildCanaryProof(p, signedLedger(p), live);
  const verified = await verifyCanaryProof(proof, { snapshot: async () => live });
  assert.equal(verified.verdict, 'VERIFIED');
  assert.equal(verified.outcome, 'RESTED_AT_PLACEMENT');
  assert.equal(verified.classification, 'ONCHAIN_SUCCESS');
  const missingEvents = snapshot(p);
  const weak = await verifyCanaryProof(buildCanaryProof(p, signedLedger(p), missingEvents),
    { snapshot: async () => missingEvents });
  assert.equal(weak.verdict, 'PARTIALLY_VERIFIED');
  assert.equal(weak.outcome, 'UNKNOWN');
});

test('revert, conflicting RPC, absent receipt and unknown selectors stay distinct', async () => {
  const p = plan();
  const reverted = snapshot(p, '0x0');
  const proof = buildCanaryProof(p, signedLedger(p), reverted);
  assert.equal((await verifyCanaryProof(proof, { snapshot: async () => reverted })).classification, 'ONCHAIN_REVERT');
  assert.equal((await verifyCanaryProof(proof, { snapshot: async () => ({ ...reverted, chainId: 1 }) })).verdict, 'FAILED');
  assert.equal((await verifyCanaryProof(proof, { snapshot: async () => ({ ...reverted, receipt: null }) })).verdict, 'INDETERMINATE');
  assert.equal((await verifyCanaryProof(proof, { snapshot: async () => snapshot(p, '0x1') })).verdict, 'FAILED');
  assert.equal(decodeExecutionError({ data: '0xdeadbeef' }, 'ESTIMATE_GAS').reason, 'UNKNOWN_REVERT');
  assert.equal(decodeExecutionError({ data: '0x7cf05fcb' }, 'ESTIMATE_GAS').reason, 'POST_ONLY_WOULD_CROSS');
});

test('official logs separate IOC full/partial fills and cancellation from missing evidence', () => {
  const p = plan();
  const iocData = encodeFunctionData({ abi: PLACE_ABI, functionName: 'placeOrderFor',
    args: [OWNER_TRADING_WALLET, true, 0n, parseUnits(input.price, 18), parseUnits(input.quantity, 8),
      BigInt(Date.parse(p.expiresAt)) * 1_000_000n, 2, 0,
      '0x0000000000000000000000000000000000000000', 0n] });
  const ioc = { ...p, executionMode: undefined, transaction: { ...p.transaction!, data: iocData } };
  const filledAbi = parseAbi(['event OrderFilled(uint128 indexed takerOrderId,uint128 indexed makerOrderId,uint256 quantityFilled,uint256 takerRemainingQuantity,uint256 makerRemainingQuantity,uint256 fillPrice)']);
  const positionAbi = parseAbi(['event PositionUpdated(address indexed account,address indexed perpPool,int128 newSize,uint128 avgEntryPrice,int256 realizedPnl,int256 entryFundingIndex)']);
  const fillLog = (amount: bigint): RawLog => ({ address: BTC_POOL,
    topics: encodeEventTopics({ abi: filledAbi, eventName: 'OrderFilled',
      args: { takerOrderId: 7n, makerOrderId: 9n } }).flat()
      .filter((value): value is `0x${string}` => typeof value === 'string'),
    data: encodeAbiParameters(filledAbi[0]!.inputs.slice(2), [amount, 0n, 0n, parseUnits(input.price, 18)]),
    logIndex: '0x1', transactionHash: txHash });
  const positionLog = (amount: bigint): RawLog => ({ address: HIDEKI_MARGIN_BANK,
    topics: encodeEventTopics({ abi: positionAbi, eventName: 'PositionUpdated',
      args: { account: OWNER_TRADING_WALLET, perpPool: BTC_POOL } }).flat()
      .filter((value): value is `0x${string}` => typeof value === 'string'),
    data: encodeAbiParameters(positionAbi[0]!.inputs.slice(2),
      [BigInt(p.positionSizeBeforeRaw) + amount, parseUnits(input.price, 18), 0n, 0n]),
    logIndex: '0x2', transactionHash: txHash });
  const full = parseUnits(input.quantity, 8);
  assert.equal(classifyCanaryEvents(ioc, snapshot(p, '0x1', [log('OrderPlaced', 0),
    fillLog(full), positionLog(full)]).receipt!), 'FULL_FILL');
  assert.equal(classifyCanaryEvents(ioc, snapshot(p, '0x1', [log('OrderPlaced', 0),
    fillLog(full / 2n), positionLog(full / 2n)]).receipt!), 'PARTIAL_FILL');
  assert.equal(classifyCanaryEvents(ioc, snapshot(p, '0x1', [log('OrderPlaced', 0),
    fillLog(full)]).receipt!), 'UNKNOWN');
  const cancelLog: RawLog = { address: BTC_POOL,
    topics: encodeEventTopics({ abi: orderBookEventsAbi, eventName: 'OrderCancelled', args: { orderId: 7n } })
      .flat().filter((value): value is `0x${string}` => typeof value === 'string'),
    data: '0x', logIndex: '0x0', transactionHash: txHash };
  const cancel = { schema: 'perp-canary/order-action-plan/v1' as const, operation: 'CANCEL' as const,
    orderId: '7', pool: BTC_POOL } as Parameters<typeof classifyCanaryEvents>[0];
  assert.equal(classifyCanaryEvents(cancel, snapshot(p, '0x1', [cancelLog]).receipt!), 'CANCELLED');
});
