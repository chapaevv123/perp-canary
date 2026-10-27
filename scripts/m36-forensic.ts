import { readBotPlanEvidence } from '../src/bot-evidence.ts';
import { verifyPreparedPlan } from '../src/delegated-plan.ts';
import { decodeExecutionError } from '../src/execution-error-decoder.ts';
import { RPC } from '../src/rpc-health.ts';
import { sha256 } from '../src/evidence.ts';
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const hash = '0c522886fcd6410659150d3c5f7572ff1f8b187c50322120f6a38366273b21e5';
const record = (await readBotPlanEvidence('bot-evidence')).find(item => item.plan.hash === hash);
if (!record || record.plan.schema !== 'perp-canary/delegated-plan/v2') throw Error('Historical plan not found');
const plan = record.plan;
verifyPreparedPlan(plan);
const request = async (method: string, params: unknown[]) => {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  return await response.json() as { result?: unknown; error?: unknown };
};
const blockTag = `0x${BigInt(plan.sampledBlock).toString(16)}`;
const [chain, block, call] = await Promise.all([
  request('eth_chainId', []), request('eth_getBlockByNumber', [blockTag, false]),
  request('eth_call', [{ from: plan.operator, to: plan.transaction!.to,
    data: plan.transaction!.data, value: '0x0', gas: `0x${BigInt(plan.risk.gasLimit).toString(16)}` }, blockTag]),
]);
const historicalBlock = block.result as { number?: string; timestamp?: string } | undefined;
const error = call.error ? decodeExecutionError(call.error, 'ETH_CALL') : null;
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
let book: { bestBid: string; bestAsk: string } | null = null;
try {
  const result = await sdk.client.getBookTopsOnchain([{ id: plan.pool as `0x${string}`,
    poolAddress: plan.pool as `0x${string}` }], { blockNumber: BigInt(plan.sampledBlock) });
  const top = result.tops[plan.pool.toLowerCase()];
  if (top) book = { bestBid: top.bestBid.toString(), bestAsk: top.bestAsk.toString() };
} catch { /* Historic book read may be unavailable. */ }
finally { sdk.close(); }
console.log(JSON.stringify({ mode: 'LIVE_READ_ONLY_HISTORICAL_REPLAY', planHash: plan.hash,
  chainId: chain.result ? Number(BigInt(String(chain.result))) : 'UNKNOWN',
  planObservedAt: plan.observedAt, planExpiresAt: plan.expiresAt,
  sampledBlock: plan.sampledBlock, blockTimestamp: historicalBlock?.timestamp ?
    new Date(Number(BigInt(historicalBlock.timestamp)) * 1000).toISOString() : 'UNKNOWN',
  from: plan.operator, to: plan.transaction?.to, calldataSha256: sha256(plan.transaction!.data),
  bookAtSampledBlock: book,
  historicalCallResult: call.result ? 'SUCCESS' : error?.reason ?? 'UNKNOWN',
  error, limitation: 'Replay uses state at the sampled block, not the unknown CLI failure block or exact estimateGas context.' }, null, 2));
