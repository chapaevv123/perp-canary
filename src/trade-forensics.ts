import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, marginBankEventsAbi, orderBookEventsAbi, perpPoolEventsAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { decodeEventLog, decodeFunctionData, formatUnits, getAddress, isAddress, parseAbi, toFunctionSelector, type Hex } from 'viem';
import { normalize, sha256 } from './evidence.ts';
import { NETWORK_REGISTRY } from './network-registry.ts';
import { rpcRead, type RpcRead } from './network-probe.ts';
import { withSnapshotSdk } from './lifecycle.ts';

export const OWNER_TX = '0xe164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc';
export const OWNER_TRADING_WALLET = '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f';
export const BTC_POOL = '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0';
export const HIDEKI_MARGIN_BANK = '0x478769E1177C0773c43a593dccc4ad15f15f1394';
export const EXPLORER_BASE = 'https://explorer.testnet.somnia.network/tokyo/tx/';
export const OFFICIAL_CALL_ABI = 'https://app.testnet.dreamdex.io/docs/developers/perps-testnet';
// Official dreamDEX developer guide gives this exact signature; the installed SDK also names selector 0x80054449.
const placeOrderForAbi = parseAbi(['function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)']);
if (toFunctionSelector(placeOrderForAbi[0]!) !== '0x80054449') throw Error('Official placeOrderFor selector mismatch');

export type Confidence = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNKNOWN' | 'MISMATCH';
export type RawTx = { hash: string; chainId?: string; blockHash: string; blockNumber: string; from: string; to: string | null;
  input: Hex; gas: string; gasPrice?: string; value: string; nonce: string; transactionIndex: string };
export type RawLog = { address: string; topics: readonly Hex[]; data: Hex; logIndex: string; transactionHash: string; removed?: boolean };
export type RawReceipt = { transactionHash: string; blockHash: string; blockNumber: string; status: string;
  from: string; to: string | null; gasUsed: string; effectiveGasPrice?: string; logs: RawLog[] };
export type RawBlock = { hash: string; number: string; timestamp: string };
export type NetworkLookup = { name: string; expectedChainId: number; observedChainId: number | null;
  status: 'FOUND' | 'NOT_FOUND' | 'RPC_ERROR' | 'WRONG_CHAIN_ID'; errorCode?: string };
export type TradeSource = { chainId: number; tx: RawTx; receipt: RawReceipt; block: RawBlock };
export type TradeEvent = { address: string; logIndex: number; eventName: string; args: Record<string, unknown> };
export type MarketIdentity = { status: 'VERIFIED' | 'UNKNOWN' | 'MISMATCH'; symbol: string | null;
  pool: string | null; marginBank: string | null; baseDecimals: number | null; quoteDecimals: number | null;
  source: string; observedAt: string };
export type ForensicsBody = { schema: 'perp-canary/trade-forensics/v1'; mode: 'LIVE_READ_ONLY'; observedAt: string;
  txHash: string; networkLookups: NetworkLookup[]; marketIdentity: MarketIdentity; chainId: number | null; transaction: RawTx | null;
  receipt: RawReceipt | null; block: RawBlock | null; decodedCall: Record<string, unknown> | null;
  decodedEvents: TradeEvent[]; unknownLogCount: number; walletAttribution: Record<string, unknown>;
  positionReconciliation: Record<string, unknown>; internalCalls: Record<string, unknown>;
  evidenceConfidence: Confidence; reasons: string[]; uiComparison: Record<string, unknown>;
  explorerUrl: string | null; sources: string[] };

function hexNumber(value: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw Error('Malformed RPC hex quantity');
  return BigInt(value);
}
function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}
function argsOf(event: TradeEvent): Record<string, unknown> { return event.args; }
function str(value: unknown): string { return String(value ?? ''); }
const unknownMarket = (): MarketIdentity => ({ status: 'UNKNOWN', symbol: null, pool: null, marginBank: null,
  baseDecimals: null, quoteDecimals: null, source: 'LIVE Markets SDK market row unavailable', observedAt: new Date().toISOString() });
export async function readBtcMarketIdentity(): Promise<MarketIdentity> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  try { return await withSnapshotSdk(sdk, controller, async () => {
    const market = (await sdk.client.listPerpMarkets()).find(row => same(row.poolAddress, BTC_POOL));
    if (!market) return { ...unknownMarket(), status: 'MISMATCH', source: 'BTC pool absent from LIVE Markets SDK market rows' };
    const valid = market.chainId === 50383 && market.baseSymbol === 'BTC' && market.quoteSymbol === 'USDso' &&
      same(market.marginBank, HIDEKI_MARGIN_BANK) && market.baseDecimals === 8 && market.quoteDecimals === 18;
    return { status: valid ? 'VERIFIED' : 'MISMATCH', symbol: `${market.baseSymbol}-PERP`,
      pool: market.poolAddress, marginBank: market.marginBank, baseDecimals: market.baseDecimals,
      quoteDecimals: market.quoteDecimals, source: 'LIVE @somnia-chain/markets-sdk@0.32.1 listPerpMarkets; Hideki indexer',
      observedAt: new Date().toISOString() };
  }, () => 'reading current BTC-PERP market identity', 45_000); }
  catch { return unknownMarket(); }
}
function traceTree(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  const call = value as Record<string, unknown>;
  return { type: call.type ?? 'UNKNOWN', from: call.from ?? null, to: call.to ?? null,
    selector: typeof call.input === 'string' ? call.input.slice(0, 10) : null,
    gasUsed: call.gasUsed ?? null, error: call.error ?? null,
    calls: Array.isArray(call.calls) ? call.calls.slice(0, 100).map(child => traceTree(child, depth + 1)) : [] };
}

export function decodeKnownLogs(receipt: RawReceipt, pool = BTC_POOL, bank = HIDEKI_MARGIN_BANK):
  { events: TradeEvent[]; unknownLogCount: number } {
  const events: TradeEvent[] = [];
  let unknownLogCount = 0;
  for (const log of receipt.logs) {
    const atPool = same(log.address, pool);
    const atBank = same(log.address, bank);
    if (!atPool && !atBank) { unknownLogCount++; continue; }
    try {
      const decoded = decodeEventLog({ abi: atBank ? marginBankEventsAbi : [...orderBookEventsAbi, ...perpPoolEventsAbi],
        topics: [...log.topics] as [Hex, ...Hex[]], data: log.data });
      events.push({ address: log.address, logIndex: Number(hexNumber(log.logIndex)), eventName: decoded.eventName,
        args: normalize(decoded.args) as Record<string, unknown> });
    } catch { unknownLogCount++; }
  }
  return { events, unknownLogCount };
}

export function analyzeTrade(source: TradeSource | null, lookups: NetworkLookup[], input: { txHash: string; tradingWallet: string;
  expectedPool?: string; trace?: unknown; marketIdentity?: MarketIdentity }): ForensicsBody {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) throw Error('Transaction hash must be 0x plus 64 hex characters');
  if (!isAddress(input.tradingWallet, { strict: false })) throw Error('Trading wallet must be a public EVM address');
  const wallet = getAddress(input.tradingWallet);
  const base = { schema: 'perp-canary/trade-forensics/v1' as const, mode: 'LIVE_READ_ONLY' as const,
    observedAt: new Date().toISOString(), txHash: input.txHash.toLowerCase(), networkLookups: lookups,
    marketIdentity: input.marketIdentity ?? unknownMarket(),
    chainId: source?.chainId ?? null, transaction: source?.tx ?? null, receipt: source?.receipt ?? null,
    block: source?.block ?? null, explorerUrl: source?.chainId === 50383 ? `${EXPLORER_BASE}${input.txHash.toLowerCase()}` : null,
    sources: [OFFICIAL_CALL_ABI, 'https://app.testnet.dreamdex.io/docs/developers/contracts/functions',
      'https://prd.smk.somnia.host/docs/typescript/reference/networks-and-endpoints',
      '@somnia-chain/markets-sdk@0.32.1 orderBookEventsAbi, perpPoolEventsAbi, marginBankEventsAbi'] };
  if (!source) return { ...base, decodedCall: null, decodedEvents: [], unknownLogCount: 0,
    walletAttribution: { status: 'UNKNOWN', tradingWallet: wallet }, positionReconciliation: { status: 'UNKNOWN' },
    internalCalls: { status: 'UNKNOWN', reason: 'No transaction receipt or trace' },
    evidenceConfidence: 'UNKNOWN', reasons: ['Transaction was not found on a verified RPC, or an RPC read failed'],
    uiComparison: { status: 'UNKNOWN', source: 'Owner-reported UI only' } };
  const { tx, receipt, chainId } = source;
  const reasons: string[] = [];
  const { events, unknownLogCount } = decodeKnownLogs(receipt);
  let decodedCall: Record<string, unknown> | null = null;
  if (tx.input.startsWith('0x80054449')) {
    try {
      const decoded = decodeFunctionData({ abi: placeOrderForAbi, data: tx.input });
      const [owner, isBid, userData, price, quantity, expireTimestampNs, orderType, selfMatchingOption, builder, builderFee] = decoded.args;
      decodedCall = { method: decoded.functionName, owner, isBid, userData: str(userData),
        limitPrice: formatUnits(price, 18), quantity: formatUnits(quantity, 8),
        rawPrice: str(price), rawQuantity: str(quantity), expireTimestampNs: str(expireTimestampNs),
        orderType, selfMatchingOption, builder, builderFee: str(builderFee), selector: '0x80054449',
        source: OFFICIAL_CALL_ABI };
    } catch { reasons.push('Selector matched placeOrderFor but calldata failed official ABI decoding'); }
  }
  const placed = events.find(event => event.eventName === 'OrderPlaced' &&
    same(str((argsOf(event).placedOrder as { owner?: string } | undefined)?.owner), wallet));
  const placedArgs = placed ? argsOf(placed) : null;
  const placedOrder = placedArgs?.placedOrder as Record<string, unknown> | undefined;
  const orderId = placedArgs ? str(placedArgs.orderId) : null;
  const fills = events.filter(event => event.eventName === 'OrderFilled' && orderId && str(argsOf(event).takerOrderId) === orderId);
  const filledRaw = fills.reduce((sum, event) => sum + BigInt(str(argsOf(event).quantityFilled)), 0n);
  const position = events.find(event => event.eventName === 'PositionUpdated' && same(str(argsOf(event).account), wallet)
    && same(str(argsOf(event).perpPool), BTC_POOL));
  const positionArgs = position ? argsOf(position) : null;
  const walletMatch = decodedCall && same(str(decodedCall.owner), wallet) && Boolean(placed);
  const poolMatch = same(tx.to, input.expectedPool ?? BTC_POOL) && same(tx.to, BTC_POOL);
  const callMatchesOrder = decodedCall && placedOrder && decodedCall.isBid === placedOrder.isBid &&
    str(decodedCall.rawQuantity) === str(placedOrder.fullQuantity);
  const fillWithinLimit = decodedCall && fills.length > 0 && fills.every(event =>
    decodedCall.isBid === true ? BigInt(str(argsOf(event).fillPrice)) <= BigInt(str(decodedCall.rawPrice)) :
      BigInt(str(argsOf(event).fillPrice)) >= BigInt(str(decodedCall.rawPrice)));
  const receiptMatchesTx = same(receipt.from, tx.from) && same(receipt.to, tx.to);
  const receiptSuccess = receipt.status === '0x1';
  const filledMatches = placedOrder && filledRaw > 0n && filledRaw === BigInt(str(placedOrder.fullQuantity)) &&
    BigInt(str(placedOrder.quantityRemaining)) === 0n;
  const positionMatches = positionArgs && BigInt(str(positionArgs.newSize)) === filledRaw && filledRaw > 0n;
  let confidence: Confidence = 'PARTIALLY_VERIFIED';
  if (chainId !== 50383 || !poolMatch || !receiptMatchesTx || base.marketIdentity.status === 'MISMATCH' ||
    (decodedCall && !same(str(decodedCall.owner), wallet)) ||
    (placed && !same(str(placedOrder?.owner), wallet))) confidence = 'MISMATCH';
  else if (!receiptSuccess) confidence = 'MISMATCH';
  else if (walletMatch && filledMatches && positionMatches && callMatchesOrder && fillWithinLimit && decodedCall?.isBid === true &&
    base.marketIdentity.status === 'VERIFIED') confidence = 'VERIFIED';
  else reasons.push('Successful receipt alone does not establish an executed BTC-PERP trade');
  if (!receiptSuccess) reasons.push('Transaction reverted');
  if (!poolMatch) reasons.push('Transaction target does not match verified BTC-PERP pool');
  if (!walletMatch) reasons.push('Trading wallet is not jointly confirmed by calldata and OrderPlaced');
  if (!filledMatches) reasons.push('Full fill for the wallet-owned taker order is not confirmed');
  if (!positionMatches) reasons.push('Matching trading-wallet PositionUpdated is not confirmed');
  if (!callMatchesOrder) reasons.push('Calldata side or quantity differs from OrderPlaced');
  if (!fillWithinLimit) reasons.push('Fill price is not proven within the calldata limit');
  if (!receiptMatchesTx) reasons.push('Receipt sender or target differs from transaction');
  const newSize = positionArgs ? formatUnits(BigInt(str(positionArgs.newSize)), 8) : null;
  const entry = positionArgs ? formatUnits(BigInt(str(positionArgs.avgEntryPrice)), 18) : null;
  const fillPrices = fills.map(event => formatUnits(BigInt(str(argsOf(event).fillPrice)), 18));
  return { ...base, decodedCall, decodedEvents: events, unknownLogCount,
    walletAttribution: { status: walletMatch ? 'VERIFIED' : 'UNKNOWN', tradingWallet: wallet,
      orderOwner: placedOrder?.owner ?? null, executionSender: tx.from, gasPayer: tx.from,
      senderIsTradingWallet: same(tx.from, wallet), orderId, loginEoaRelationship: 'UNKNOWN' },
    positionReconciliation: { status: positionMatches ? 'VERIFIED' : 'UNKNOWN', pool: BTC_POOL,
      filledQuantity: filledRaw > 0n ? formatUnits(filledRaw, 8) : null, fillPrices,
      positionSizeAfterEvent: newSize, avgEntryPriceAfterEvent: entry,
      initialMarginAtExecution: 'UNKNOWN', currentPosition: 'UNKNOWN' },
    internalCalls: input.trace ? { status: 'PARTIALLY_VERIFIED', trace: traceTree(input.trace),
      source: 'Hideki debug_traceTransaction callTracer; bounded tree to depth 12 and 100 children per node; unknown selectors remain undecoded' } :
      { status: 'UNKNOWN', reason: 'Exact call tree unavailable; MarginBank logs prove contract effects' },
    evidenceConfidence: confidence, reasons: confidence === 'VERIFIED' ? ['OrderPlaced, OrderFilled and PositionUpdated match the wallet and BTC-PERP pool'] : reasons,
    uiComparison: { source: 'Owner-reported dreamDEX UI; not a historical state proof',
      quantity: newSize === '0.05416' ? 'MATCHED' : 'UNKNOWN',
      entry: entry === '80043.8' ? 'MATCHED' : 'UNKNOWN',
      long: decodedCall?.isBid === true && positionArgs && BigInt(str(positionArgs.newSize)) > 0n ? 'MATCHED' : 'UNKNOWN',
      initialMargin216_22: 'UNKNOWN' } };
}

export async function collectTradeForensics(input: { txHash: string; tradingWallet: string }, read: RpcRead = rpcRead):
  Promise<ForensicsBody & { hash: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) throw Error('Transaction hash must be 0x plus 64 hex characters');
  if (!isAddress(input.tradingWallet, { strict: false })) throw Error('Trading wallet must be a public EVM address');
  const results = await Promise.all(NETWORK_REGISTRY.map(async network => {
    try {
      const chainId = Number(hexNumber(str(await read(network.rpc, 'eth_chainId', []))));
      if (chainId !== network.chainId) return { lookup: { name: network.name, expectedChainId: network.chainId,
        observedChainId: chainId, status: 'WRONG_CHAIN_ID' as const }, source: null };
      const [tx, receipt] = await Promise.all([
        read(network.rpc, 'eth_getTransactionByHash', [input.txHash]),
        read(network.rpc, 'eth_getTransactionReceipt', [input.txHash]),
      ]);
      if (!tx || !receipt) return { lookup: { name: network.name, expectedChainId: network.chainId,
        observedChainId: chainId, status: 'NOT_FOUND' as const }, source: null };
      const transaction = tx as RawTx;
      const transactionReceipt = receipt as RawReceipt;
      const block = await read(network.rpc, 'eth_getBlockByNumber', [transactionReceipt.blockNumber, false]) as RawBlock;
      if (!block || !same(transaction.blockHash, transactionReceipt.blockHash) || !same(block.hash, transactionReceipt.blockHash)
        || !same(transaction.hash, input.txHash) || !same(transactionReceipt.transactionHash, input.txHash))
        throw Error('Transaction, receipt and block hashes disagree');
      return { lookup: { name: network.name, expectedChainId: network.chainId,
        observedChainId: chainId, status: 'FOUND' as const },
      source: { chainId, tx: transaction, receipt: transactionReceipt, block } };
    } catch { return { lookup: { name: network.name, expectedChainId: network.chainId,
      observedChainId: null, status: 'RPC_ERROR' as const, errorCode: 'READ_FAILED' }, source: null }; }
  }));
  const sources = results.filter(result => result.source).map(result => result.source!);
  const lookups = results.map(result => result.lookup);
  let trace: unknown;
  if (sources.length === 1 && sources[0]?.chainId === 50383) {
    try { trace = await read(NETWORK_REGISTRY[0]!.rpc, 'debug_traceTransaction',
      [input.txHash, { tracer: 'callTracer', timeout: '10s' }]); }
    catch { /* Trace is optional; receipt events remain available. */ }
  }
  const marketIdentity = sources.length === 1 && sources[0]?.chainId === 50383
    ? await readBtcMarketIdentity() : unknownMarket();
  const body = analyzeTrade(sources.length === 1 ? sources[0]! : null, lookups, { ...input, trace, marketIdentity });
  if (sources.length > 1) { body.evidenceConfidence = 'MISMATCH'; body.reasons = ['Same hash found on multiple supported networks']; }
  return { ...body, hash: sha256(body) };
}
