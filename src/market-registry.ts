import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, type PerpMarket } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatUnits, getAddress, http, parseAbi, type Address } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC } from './rpc-health.ts';
import { HIDEKI_MARGIN_BANK } from './trade-forensics.ts';

const FACTORY = '0xE631fAEE547baeE07353E290f0562ea67d856560';
const COLLATERAL = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72';
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 12_000, retryCount: 1 }) });
const bookAbi = parseAbi(['function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])']);
const poolAbi = parseAbi(['function marginBank() view returns (address)']);
const parametersAbi = parseAbi(['function getOrderBookParameters() view returns ((uint256 tickSize,uint256 minQuantity,uint256 lotSize))']);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type VerifiedMarket = { id: string; symbol: string; pool: Address; marginBank: Address;
  base: string; quote: string; baseDecimals: number; quoteDecimals: number; tickSizeRaw: string;
  lotSizeRaw: string; minQuantityRaw: string; initialMarginBps: number;
  status: 'TRADEABLE' | 'CLOSE_ONLY' | 'UNREGISTERED' | 'UNKNOWN'; source: string;
  orderTypes: ['POST_ONLY']; };

async function withSdk<T>(work: (sdk: SomniaMarkets) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, () => work(sdk), () => 'reading market registry', 45_000);
}
export function validateRegistryRow(row: PerpMarket, status: { pool: string; marginBank: string;
  registered: boolean | null; tradeable: boolean | null; restricted: boolean } | undefined,
  collateral: string): VerifiedMarket {
  if (!status || !same(row.poolAddress, status.pool) || !same(row.marginBank, status.marginBank) ||
    !same(row.marginBank, HIDEKI_MARGIN_BANK) || !same(row.quoteToken, COLLATERAL) ||
    !same(collateral, COLLATERAL) || row.quoteDecimals !== 18 ||
    !row.baseSymbol || !row.quoteSymbol || row.baseDecimals < 1 || row.baseDecimals > 36 ||
    BigInt(row.tickSize) <= 0n || BigInt(row.lotSize) <= 0n || BigInt(row.minQuantity) <= 0n)
    throw Error(`Market ${row.id} registry or on-chain wiring mismatch`);
  return { id: row.id, symbol: `${row.baseSymbol}-PERP`, pool: getAddress(row.poolAddress),
    marginBank: getAddress(row.marginBank), base: row.baseSymbol, quote: row.quoteSymbol,
    baseDecimals: row.baseDecimals, quoteDecimals: row.quoteDecimals,
    tickSizeRaw: row.tickSize, lotSizeRaw: row.lotSize, minQuantityRaw: row.minQuantity,
    initialMarginBps: row.initialMarginBps,
    status: status.registered === false ? 'UNREGISTERED' : status.restricted ? 'CLOSE_ONLY' :
      status.tradeable === true ? 'TRADEABLE' : 'UNKNOWN', source: 'SDK_INDEXER_AND_FACTORY_STATUS', orderTypes: ['POST_ONLY'] };
}
let cached: { until: number; markets: VerifiedMarket[] } | null = null;
let inFlight: Promise<VerifiedMarket[]> | null = null;
export async function listVerifiedMarkets(fresh = false): Promise<VerifiedMarket[]> {
  if (!fresh && cached && Date.now() < cached.until) return cached.markets;
  if (inFlight) return inFlight;
  inFlight = withSdk(async sdk => {
    const [rows, statuses, system] = await Promise.all([
      sdk.client.listPerpMarkets(), sdk.client.listPerpPoolStatuses({ factory: FACTORY }),
      sdk.client.getPerpSystemConfig(getAddress(HIDEKI_MARGIN_BANK.toLowerCase())),
    ]);
    if (!same(system.collateralToken, COLLATERAL) || !same(system.perpPoolFactory, FACTORY) ||
      !same(system.marginBank, HIDEKI_MARGIN_BANK)) throw Error('Perp system wiring mismatch');
    const byPool = new Map(statuses.map(s => [s.pool.toLowerCase(), s]));
    const markets = rows.map(row => validateRegistryRow(row, byPool.get(row.poolAddress.toLowerCase()), system.collateralToken));
    cached = { until: Date.now() + 60_000, markets };
    return markets;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
export async function verifiedMarket(id: string, fresh = false): Promise<VerifiedMarket> {
  const market = (await listVerifiedMarkets(fresh)).find(row => same(row.id, id) || same(row.symbol, id));
  if (!market) throw Error('Market is absent from verified registry');
  return market;
}
export async function readVerifiedMarket(id: string, fresh = false) {
  const market = await verifiedMarket(id, fresh);
  const block = await client.getBlock();
  if (Number(block.timestamp) * 1000 < Date.now() - 30_000) throw Error('RPC block is stale');
  const [sdkRead, bids, asks, bank, parameters] = await Promise.all([
    withSdk(async sdk => Promise.all([
      sdk.client.getBookTopsOnchain([{ id: market.id, poolAddress: market.pool }], { blockNumber: block.number }),
      sdk.client.getPerpState(market.pool),
    ])),
    client.readContract({ address: market.pool, abi: bookAbi, functionName: 'getBookLevels',
      args: [true, 5n], blockNumber: block.number }),
    client.readContract({ address: market.pool, abi: bookAbi, functionName: 'getBookLevels',
      args: [false, 5n], blockNumber: block.number }),
    client.readContract({ address: market.pool, abi: poolAbi, functionName: 'marginBank', blockNumber: block.number }),
    client.readContract({ address: market.pool, abi: parametersAbi, functionName: 'getOrderBookParameters',
      blockNumber: block.number }),
  ]);
  const [tops, state] = sdkRead;
  const after = await client.getBlock({ blockNumber: block.number });
  const sdkTop = tops.tops[market.id.toLowerCase()];
  const rawBid = bids[0]?.price, rawAsk = asks[0]?.price;
  const reasons: string[] = [];
  if (market.status !== 'TRADEABLE') reasons.push(`MARKET_${market.status}`);
  if (!same(bank, market.marginBank)) reasons.push('POOL_BANK_MISMATCH');
  if (parameters.tickSize.toString() !== market.tickSizeRaw ||
    parameters.minQuantity.toString() !== market.minQuantityRaw ||
    parameters.lotSize.toString() !== market.lotSizeRaw) reasons.push('POOL_GRID_MISMATCH');
  if (tops.blockNumber !== block.number || after.hash !== block.hash) reasons.push('BLOCK_MISMATCH');
  if (!sdkTop || !rawBid || !rawAsk || rawBid <= 0n || rawAsk <= rawBid ||
    sdkTop.bestBid !== rawBid.toString() || sdkTop.bestAsk !== rawAsk.toString()) reasons.push('SDK_DIRECT_BOOK_MISMATCH');
  if (rawBid && rawBid % BigInt(market.tickSizeRaw) !== 0n ||
    rawAsk && rawAsk % BigInt(market.tickSizeRaw) !== 0n) reasons.push('OFF_TICK_GRID');
  if (!state.markPriceOk || state.markPrice <= 0n) reasons.push('MARK_UNAVAILABLE');
  if (Number(block.timestamp) * 1000 < Date.now() - 30_000) reasons.push('STALE_BLOCK');
  const fmt = (value: bigint) => formatUnits(value, market.quoteDecimals);
  const levels = (rows: typeof bids) => rows.map(level => ({ price: fmt(level.price),
    quantity: formatUnits(level.quantity, market.baseDecimals) }));
  const observedAt = new Date().toISOString();
  return { market, chainId: 50383, observedAt, block: block.number.toString(),
    mark: state.markPriceOk ? fmt(state.markPrice) : null,
    book: { status: reasons.length ? 'UNTRUSTED' : 'TRUSTED', reasons,
      observedAt, block: block.number.toString(), bid: rawBid ? fmt(rawBid) : null,
      ask: rawAsk ? fmt(rawAsk) : null, source: 'SDK_ONCHAIN_PINNED_AND_DIRECT_HTTPS' },
    depth: { status: reasons.length ? 'UNAVAILABLE' : 'VERIFIED', bids: levels(bids), asks: levels(asks) },
    grid: { tickSizeRaw: market.tickSizeRaw, lotSizeRaw: market.lotSizeRaw,
      minQuantityRaw: market.minQuantityRaw, baseDecimals: market.baseDecimals,
      quoteDecimals: market.quoteDecimals },
    risk: { market: market.status === 'TRADEABLE' ? 'SUPPORTED' : 'BLOCKED', gas: 'NOT_RUN', reasons },
    bot: { placeGrant: 'NOT_APPLICABLE', cancelGrant: 'NOT_APPLICABLE' },
    margin: { status: 'NOT_RUN', unlockedUsdso: 'UNKNOWN' },
    mode: 'LIVE_READ_ONLY' as const };
}
