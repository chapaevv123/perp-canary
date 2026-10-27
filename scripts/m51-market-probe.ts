import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
try {
  const [markets, statuses] = await Promise.all([
    sdk.client.listPerpMarkets(),
    sdk.client.listPerpPoolStatuses({ factory: '0xE631fAEE547baeE07353E290f0562ea67d856560' }),
  ]);
  const byPool = new Map(statuses.map(row => [row.pool.toLowerCase(), row]));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), count: markets.length,
    markets: markets.map(m => ({ id: m.id, pool: m.poolAddress, base: m.baseSymbol,
      quote: m.quoteSymbol, baseDecimals: m.baseDecimals, quoteDecimals: m.quoteDecimals,
      tick: m.tickSize, lot: m.lotSize, min: m.minQuantity,
      status: byPool.get(m.poolAddress.toLowerCase())?.tradeable ?? null })) }, null, 2));
} finally { clearTimeout(timer); controller.abort(); }
