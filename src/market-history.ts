import { formatUnits } from 'viem';
import { verifiedMarket } from './market-registry.ts';
import { getCandles } from '../node_modules/@somnia-chain/markets-sdk/dist/candles.js';
import { getFills } from '../node_modules/@somnia-chain/markets-sdk/dist/fills.js';

export const CANDLE_INTERVALS = [60, 300, 900, 3600, 14400, 86400] as const;
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';

async function indexed<T>(key: string, read: () => Promise<T>): Promise<T> {
  const old = cache.get(key);
  if (old && old.until > Date.now()) return old.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('Indexer history request timed out after 25 seconds')), 25_000);
  });
  const task = Promise.race([read(), deadline])
    .then(value => { cache.set(key, { until: Date.now() + 30_000, value }); return value; })
    .finally(() => { if (timer) clearTimeout(timer); pending.delete(key); });
  pending.set(key, task);
  return task;
}

export async function readMarketCandles(symbol: string, interval: number) {
  if (!CANDLE_INTERVALS.includes(interval as typeof CANDLE_INTERVALS[number]))
    throw Error('Unsupported candle interval');
  const market = await verifiedMarket(symbol);
  return indexed(`candles:${market.pool}:${interval}`, async () => {
    const rows = await getCandles(market.pool, interval, { market: market.pool, limit: 120 }, INDEXER);
    return { chainId: 50383, market: market.symbol, pool: market.pool, intervalSeconds: interval,
      source: 'OFFICIAL_SDK_INDEXER_FILL_DERIVED', observedAt: new Date().toISOString(),
      status: rows.length ? 'AVAILABLE' : 'UNAVAILABLE',
      reason: rows.length ? null : 'No indexed fill-derived candles for this pool and interval',
      candles: rows.map(row => ({ time: Number(row.bucketStart),
        open: formatUnits(BigInt(row.openPrice), market.quoteDecimals),
        high: formatUnits(BigInt(row.high), market.quoteDecimals),
        low: formatUnits(BigInt(row.low), market.quoteDecimals),
        close: formatUnits(BigInt(row.closePrice), market.quoteDecimals),
        volumeBase: formatUnits(BigInt(row.baseVolume), market.baseDecimals),
        trades: row.tradeCount })) };
  });
}

export async function readMarketTrades(symbol: string) {
  const market = await verifiedMarket(symbol);
  return indexed(`trades:${market.pool}`, async () => {
    const rows = await getFills(market.pool, { market: market.pool, limit: 20 }, INDEXER);
    return { chainId: 50383, market: market.symbol, pool: market.pool,
      source: 'OFFICIAL_SDK_INDEXER_FILLS', observedAt: new Date().toISOString(),
      status: rows.length ? 'AVAILABLE' : 'UNAVAILABLE',
      trades: rows.map(row => ({ id: row.id, time: Number(row.timestamp),
        side: row.takerIsBid === null ? 'UNKNOWN' : row.takerIsBid ? 'BUY' : 'SELL',
        price: formatUnits(BigInt(row.fillPrice), market.quoteDecimals),
        quantity: formatUnits(BigInt(row.quantity), market.baseDecimals),
        block: row.blockNumber ?? null, txHash: row.txHash })) };
  });
}
