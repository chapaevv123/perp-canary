import { readFile } from 'node:fs/promises';
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { evaluateFeed, normalize, type MarketObservation, type SnapshotBody } from './evidence.ts';
import { withSnapshotSdk } from './lifecycle.ts';

const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const WSS = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
type RpcResult = { result?: unknown; error?: { message?: string } };

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const result = await response.json() as RpcResult;
    if (result.error) throw new Error(`RPC ${result.error.message ?? 'unknown error'}`);
    return result.result;
  } finally { clearTimeout(timer); }
}

function hex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export async function collectLive(): Promise<Omit<SnapshotBody, 'previousHash'>> {
  const chainId = Number(BigInt(hex(await rpc('eth_chainId'), 'chain ID')));
  if (chainId !== 50383 || hidekiTestnet.id !== chainId) throw new Error(`Wrong chain ID ${chainId}`);
  const block = await rpc('eth_getBlockByNumber', ['latest', false]) as Record<string, unknown> | null;
  if (!block) throw new Error('RPC returned no block');
  const blockNumber = BigInt(hex(block.number, 'block number')).toString();
  const blockHash = hex(block.hash, 'block hash');
  const blockTimestamp = BigInt(hex(block.timestamp, 'block timestamp')).toString();

  const sdkPackage = JSON.parse(await readFile('node_modules/@somnia-chain/markets-sdk/package.json', 'utf8')) as { version: string };
  if (sdkPackage.version !== '0.32.1') throw new Error(`Unexpected SDK ${sdkPackage.version}`);
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet, wsRpcUrl: WSS, indexerUrl: INDEXER,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  let phase = 'listing perp markets';
  return withSnapshotSdk(sdk, controller, async () => {
  const markets = await sdk.client.listPerpMarkets();
  if (markets.length === 0) throw new Error('No perp markets returned by indexer');
  const firstMarket = markets[0]!;
  phase = 'reading system configuration';
  const systemConfig = await sdk.client.getPerpSystemConfig(firstMarket.marginBank);
  phase = 'reading factory pool statuses';
  const statuses = await sdk.client.listPerpPoolStatuses({ factory: systemConfig.perpPoolFactory });
  const statusByPool = new Map(statuses.map(status => [status.pool.toLowerCase(), status]));

  const observations: MarketObservation[] = [];
  for (const market of markets) {
    phase = `reading ${market.baseSymbol ?? market.poolAddress} feed`;
    const poolStatus = statusByPool.get(market.poolAddress.toLowerCase()) ?? null;
    let feed: unknown;
    let gate: MarketObservation['gate'];
    let reasons: string[];
    try {
      feed = normalize(await sdk.client.getPerpFeedStatus(market.poolAddress));
      ({ gate, reasons } = evaluateFeed(feed));
    } catch (error) {
      feed = { error: error instanceof Error ? error.message : String(error) };
      gate = 'UNKNOWN'; reasons = ['Feed read failed'];
    }
    if (!poolStatus) { gate = 'UNKNOWN'; reasons.push('Indexer market absent from factory status list'); }
    observations.push({ poolAddress: market.poolAddress, symbol: `${market.baseSymbol ?? 'UNKNOWN'}-PERP`,
      market: normalize(market), poolStatus: normalize(poolStatus), feed, gate, reasons });
  }
  return { schema: 'perp-canary/snapshot/v1', mode: 'LIVE', observedAt: new Date().toISOString(),
    chainId, blockNumber, blockHash, blockTimestamp,
    sources: { sdk: '@somnia-chain/markets-sdk', rpc: RPC, indexer: INDEXER }, sdkVersion: sdkPackage.version,
    systemConfig: normalize(systemConfig), markets: observations,
    limitations: ['SDK market rows come from the indexer and may lag the sampled RPC block.',
      'Per-market feed reads occur after the sampled block and are not block-pinned.',
      'GREEN refers only to the observed mark feed; execution availability is not yet verified.'] };
  }, () => phase);
}
