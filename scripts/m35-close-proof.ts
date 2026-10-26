import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, http } from 'viem';
import { BTC_POOL, HIDEKI_MARGIN_BANK, decodeKnownLogs } from '../src/trade-forensics.ts';
import { RPC } from '../src/rpc-health.ts';
import { rpcRead } from '../src/network-probe.ts';

// Public read-only research. A CLOSE history row alone does not prove atomic reduce-only execution.
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
const rpc = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
function calls(node: unknown, depth = 0): Array<Record<string, unknown>> {
  if (!node || typeof node !== 'object' || depth > 8) return [];
  const call = node as Record<string, unknown>;
  return [{ depth, from: call.from, to: call.to, selector: typeof call.input === 'string' ?
    call.input.slice(0, 10) : null, error: call.error ?? null },
  ...(Array.isArray(call.calls) ? call.calls.flatMap(child => calls(child, depth + 1)) : [])];
}
try {
  const hashes = [
    '0x8d53ff5e33c4208bc180e7b9822bcd16de4cad75cb4ce80a2a4d7b2cc096416f',
    '0x2c2af053a01b6c33d5d5bdbf0b88275580ba6444b5d86a926483bd2c7fd13f15',
  ];
  const rows = (await Promise.all(hashes.map(txHash => sdk.client.listPerpPositionChanges({
    pool: BTC_POOL, txHash, kinds: ['CLOSE'], limit: 5,
  })))).flat();
  if (rows.length !== hashes.length || rows.some(row => row.sizeAfter !== 0n))
    throw Error('Expected two indexed BTC-PERP CLOSE rows ending at zero');
  const result = [];
  for (const row of rows) {
    const hash = row.txHash as `0x${string}`;
    const [tx, receipt] = await Promise.all([
      rpc.getTransaction({ hash }), rpc.getTransactionReceipt({ hash }),
    ]);
    const trace = await rpcRead(RPC, 'debug_traceTransaction',
      [hash, { tracer: 'callTracer', timeout: '10s' }]).catch(() => null);
    const logs = decodeKnownLogs({ logs: receipt.logs.map(log => ({ address: log.address,
      topics: log.topics, data: log.data, logIndex: `0x${log.logIndex.toString(16)}`,
      transactionHash: hash })), transactionHash: hash, blockHash: receipt.blockHash,
      blockNumber: `0x${receipt.blockNumber.toString(16)}`,
      status: receipt.status === 'success' ? '0x1' : '0x0',
      from: receipt.from, to: receipt.to, gasUsed: `0x${receipt.gasUsed.toString(16)}` },
    BTC_POOL, HIDEKI_MARGIN_BANK).events;
    if (receipt.status !== 'success' || !logs.some(event => event.eventName === 'PositionUpdated' &&
      String(event.args.account).toLowerCase() === row.account.toLowerCase() &&
      String(event.args.newSize) === '0')) throw Error(`Receipt does not prove close ${hash}`);
    result.push({ txHash: hash, blockNumber: row.blockNumber.toString(), account: row.account,
      sizeBeforeRaw: row.sizeBefore.toString(), sizeAfterRaw: row.sizeAfter.toString(),
      kind: row.kind, orderId: row.orderId?.toString() ?? null,
      txFrom: tx.from, txTo: tx.to, txSelector: tx.input.slice(0, 10),
      receiptStatus: receipt.status, receiptLogs: receipt.logs.length,
      accountEvents: logs.filter(event => event.eventName === 'PositionUpdated' &&
        String(event.args.account).toLowerCase() === row.account.toLowerCase()).map(event => ({
        address: event.address, newSize: String(event.args.newSize), logIndex: event.logIndex,
      })),
      orderEvents: logs.filter(event => ['OrderPlaced', 'OrderFilled'].includes(event.eventName))
        .map(event => ({ name: event.eventName, address: event.address, logIndex: event.logIndex })),
      calls: calls(trace).filter(call => String(call.to).toLowerCase() === BTC_POOL.toLowerCase() ||
        call.depth === 0),
    });
  }
  console.log(JSON.stringify({ mode: 'LIVE_READ_ONLY', checkedAt: new Date().toISOString(),
    chainId: await rpc.getChainId(), rows: result }, null, 2));
} finally { sdk.close(); }
