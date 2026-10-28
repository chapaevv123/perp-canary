import { createPublicClient, getAddress, http } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { verifiedMarket } from './market-registry.ts';
import { RPC } from './rpc-health.ts';

const WS = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 8_000, retryCount: 0 }) });
type Source = { status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE'; code: string; detail: string;
  block?: string };
const cached = new Map<string, { until: number; value: Awaited<ReturnType<typeof collect>> }>();
const pending = new Map<string, Promise<Awaited<ReturnType<typeof collect>>>>();

export function sourceError(error: unknown): Source {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const value = current instanceof Error ?
      `${current.name} ${current.message} ${(current as Error & { code?: string }).code ?? ''}`.toLowerCase() :
      typeof current === 'object' ?
        `${(current as { code?: string }).code ?? ''} ${(current as { message?: string }).message ?? ''}`.toLowerCase() :
        String(current).toLowerCase();
    if (/eacces|eperm|not permitted|access denied/.test(value))
      return { status: 'UNAVAILABLE', code: 'NETWORK_PERMISSION', detail: 'This server process cannot reach the external service. Restart it with outbound HTTPS and WebSocket access.' };
    if (/enotfound|dns|name resolution/.test(value))
      return { status: 'UNAVAILABLE', code: 'DNS', detail: 'Host lookup failed. Check DNS and network access.' };
    if (/timeout|timed out|abort/.test(value))
      return { status: 'UNAVAILABLE', code: 'TIMEOUT', detail: 'The service did not answer within the read-only timeout. Retry shortly.' };
    if (/genesis/.test(value))
      return { status: 'UNAVAILABLE', code: 'SDK_GENESIS_CHECK', detail: 'SDK genesis verification could not finish. Check WebSocket status and retry; no chain identity is assumed.' };
    if (/wrong chain|chain id/.test(value))
      return { status: 'UNAVAILABLE', code: 'CHAIN_MISMATCH', detail: 'Chain identity or genesis validation failed. Trading remains blocked.' };
    if (typeof current === 'object') {
      const nested = current as { cause?: unknown; errors?: unknown[] };
      if (nested.cause) queue.push(nested.cause);
      if (Array.isArray(nested.errors)) queue.push(...nested.errors);
    }
  }
  return { status: 'UNAVAILABLE', code: 'SOURCE_ERROR', detail: 'Source read failed. Retry or inspect the local service log.' };
}

async function httpRpc(): Promise<Source> {
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
  if (chainId !== 50383) return { status: 'UNAVAILABLE', code: 'CHAIN_MISMATCH', detail: `RPC returned chain ${chainId}.` };
  if (Number(block.timestamp) * 1000 < Date.now() - 30_000)
    return { status: 'DEGRADED', code: 'STALE_BLOCK', detail: 'RPC head is more than 30 seconds old.', block: block.number.toString() };
  return { status: 'HEALTHY', code: 'OK', detail: 'Hideki 50383 HTTP RPC is current.', block: block.number.toString() };
}

async function websocketRpc(): Promise<Source> {
  const chain = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(WS);
    const timer = setTimeout(() => { socket.close(); reject(Error('WebSocket timeout')); }, 8_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })));
    socket.addEventListener('message', event => {
      try { const data = JSON.parse(String(event.data)) as { id?: number; result?: string; error?: unknown };
        if (data.id !== 1) return;
        clearTimeout(timer); socket.close();
        if (data.error || !data.result) reject(Error('WebSocket RPC response invalid'));
        else resolve(Number(data.result));
      } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('WebSocket connection failed')); });
  });
  return chain === 50383 ? { status: 'HEALTHY', code: 'OK', detail: 'Hideki 50383 WebSocket RPC responds.' } :
    { status: 'UNAVAILABLE', code: 'CHAIN_MISMATCH', detail: `WebSocket returned chain ${chain}.` };
}

async function indexer(): Promise<Source> {
  const response = await fetch(INDEXER, { method: 'POST', signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query IndexedChains { chain_metadata { chain_id latest_processed_block } }' }) });
  if (!response.ok) throw Error(`Indexer HTTP ${response.status}`);
  const body = await response.json() as { data?: { chain_metadata?: Array<{ chain_id: number; latest_processed_block?: number }> }; errors?: unknown };
  if (body.errors || !Array.isArray(body.data?.chain_metadata)) throw Error('Indexer chain metadata invalid');
  const row = body.data.chain_metadata.find(item => item.chain_id === 50383);
  if (!row) return { status: 'UNAVAILABLE', code: 'CHAIN_MISMATCH', detail: 'Indexer has no Hideki 50383 chain binding.' };
  return { status: 'HEALTHY', code: 'OK', detail: 'GraphQL indexer serves Hideki 50383.',
    block: row.latest_processed_block == null ? undefined : String(row.latest_processed_block) };
}

async function pool(symbol: string): Promise<Source> {
  const market = await verifiedMarket(symbol);
  const code = await client.getCode({ address: getAddress(market.pool) });
  if (!code || code === '0x') return { status: 'UNAVAILABLE', code: 'POOL_MISSING', detail: `${symbol} pool has no contract code.` };
  return market.status === 'TRADEABLE' ? { status: 'HEALTHY', code: 'OK', detail: `${symbol} pool is verified and active.` } :
    { status: 'DEGRADED', code: `MARKET_${market.status}`, detail: `${symbol} is ${market.status.toLowerCase().replace('_', ' ')}.` };
}

async function settled(work: () => Promise<Source>): Promise<Source> {
  try { return await work(); } catch (error) { return sourceError(error); }
}
async function collect(symbol: string) {
  const [rpc, websocket, graphql, selectedPool] = await Promise.all([
    settled(httpRpc), settled(websocketRpc), settled(indexer), settled(() => pool(symbol)),
  ]);
  return { chainId: 50383, market: symbol, observedAt: new Date().toISOString(),
    rpc, websocket, indexer: graphql, pool: selectedPool };
}
export async function readSourceHealth(symbol: string) {
  if (!/^[A-Z0-9]{2,16}-PERP$/.test(symbol)) throw Error('Invalid perp market symbol');
  const old = cached.get(symbol);
  if (old && old.until > Date.now()) return old.value;
  if (pending.has(symbol)) return pending.get(symbol)!;
  const task = collect(symbol).then(value => { cached.set(symbol, { until: Date.now() + 25_000, value }); return value; })
    .finally(() => pending.delete(symbol));
  pending.set(symbol, task);
  return task;
}
