import { orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeEventTopics,
  formatUnits, http, toHex, type Hex } from 'viem';
import { DELEGATED_PLACE_ABI, readAccountOrderHistory, readDelegatedAccount } from '../src/delegated-browser-trade.ts';
import { RPC } from '../src/rpc-health.ts';
import { EXPECTED_METAMASK } from '../src/wallet-funding.ts';

const orderId = 14978756187852164141712n;
const placementBlock = 34789238n;
const pool = '0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0' as const;
const hash = '0xb542d3a603b33a598f8dab8d2e4f38c8b7ee163bfbd169dd32acc9429d35d28f' as const;
const client = createPublicClient({ chain: hidekiTestnet,
  transport: http(RPC, { timeout: 20_000, retryCount: 1 }) });
const head = await client.getBlockNumber();
const [tx, receipt, account, history] = await Promise.all([
  client.getTransaction({ hash }), client.getTransactionReceipt({ hash }),
  readDelegatedAccount(EXPECTED_METAMASK, 'BTC-PERP'),
  readAccountOrderHistory(EXPECTED_METAMASK, 'DELEGATED_PERPS', 'BTC-PERP'),
]);
const call = decodeFunctionData({ abi: DELEGATED_PLACE_ABI, data: tx.input });
const orderTopic = toHex(orderId, { size: 32 });
const lifecycleNames = ['OrderPlaced', 'OrderRested', 'OrderCancelled', 'OrderExpired',
  'OrderReduced', 'OrderCancelledSelfMatch', 'MakerOrderCancelledExceedsPosition',
  'OrderCancelledPreFill'] as const;
const lifecycleTopics = lifecycleNames.map(name => encodeEventTopics({ abi: orderBookEventsAbi,
  eventName: name })[0]!);
const fillTopic = encodeEventTopics({ abi: orderBookEventsAbi, eventName: 'OrderFilled' })[0]!;
type RawLog = { address: string; blockNumber: Hex; transactionHash: Hex;
  logIndex: Hex; topics: readonly Hex[]; data: Hex };
const logs: RawLog[] = [];
for (let from = placementBlock; from <= head; from += 1000n) {
  const to = from + 999n > head ? head : from + 999n;
  for (const topics of [[lifecycleTopics, orderTopic], [fillTopic, orderTopic],
    [fillTopic, null, orderTopic]] as Array<Array<Hex[] | Hex | null>>) {
    const found = await client.request({ method: 'eth_getLogs', params: [{ address: pool,
      fromBlock: toHex(from), toBlock: toHex(to), topics }] });
    logs.push(...found as RawLog[]);
  }
}
const unique = [...new Map(logs.map(log => [`${log.transactionHash}:${log.logIndex}`, log])).values()]
  .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
    Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
const events = unique.map(log => {
  const decoded = decodeEventLog({ abi: orderBookEventsAbi, topics: log.topics, data: log.data });
  const args = decoded.args as Record<string, unknown>;
  return { name: decoded.eventName, block: BigInt(log.blockNumber).toString(),
    transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)),
    orderId: String(args.orderId ?? args.makerOrderId ?? args.takerOrderId),
    takerOrderId: args.takerOrderId === undefined ? null : String(args.takerOrderId),
    makerOrderId: args.makerOrderId === undefined ? null : String(args.makerOrderId),
    owner: (args.placedOrder as { owner?: string } | undefined)?.owner ?? null,
    quantityFilled: args.quantityFilled === undefined ? null : formatUnits(args.quantityFilled as bigint, 8),
    takerRemaining: args.takerRemainingQuantity === undefined ? null :
      formatUnits(args.takerRemainingQuantity as bigint, 8),
    makerRemaining: args.makerRemainingQuantity === undefined ? null :
      formatUnits(args.makerRemainingQuantity as bigint, 8),
    fillPrice: args.fillPrice === undefined ? null : formatUnits(args.fillPrice as bigint, 18) };
});
const placed = events.find(event => event.name === 'OrderPlaced');
const fill = events.find(event => event.name === 'OrderFilled');
const fillReceipt = fill ? await client.getTransactionReceipt({ hash: fill.transactionHash }) : null;
const evidence = { schema: 'perp-canary/verified-delegated-btc-order/v1',
  observedAt: new Date().toISOString(), sources: { receiptsAndEvents: 'LIVE_ON_CHAIN',
    accountAndOpenOrders: 'LIVE_READ_ONLY_ON_CHAIN', history: 'OFFICIAL_SDK_INDEXER_NONFINAL',
    priorPosition: 'PRIOR_LIVE_READ_ONLY_OBSERVATION' },
  chainId: await client.getChainId(), head: head.toString(),
  placement: { hash, block: tx.blockNumber?.toString(), receiptBlock: receipt.blockNumber.toString(),
    status: receipt.status, from: tx.from, to: tx.to, selector: tx.input.slice(0, 10),
    callOwner: String(call.args[0]), isBid: call.args[1], price: formatUnits(call.args[3], 18),
    quantity: formatUnits(call.args[4], 8), orderType: call.args[6],
    receiptMatchingOrderLogs: receipt.logs.filter(log => log.address.toLowerCase() === pool.toLowerCase())
      .filter(log => log.topics[1]?.toLowerCase() === orderTopic.toLowerCase()).length },
  orderId: orderId.toString(), placedOwner: placed?.owner, events,
  fillReceipt: fillReceipt ? { status: fillReceipt.status, block: fillReceipt.blockNumber.toString(),
    hash: fillReceipt.transactionHash,
    containsMatchingPoolLog: fillReceipt.logs.some(log => log.address.toLowerCase() === pool.toLowerCase() &&
      log.topics[0]?.toLowerCase() === fillTopic.toLowerCase() &&
      (log.topics[1]?.toLowerCase() === orderTopic.toLowerCase() ||
        log.topics[2]?.toLowerCase() === orderTopic.toLowerCase())) } : null,
  current: { block: account.block, owner: account.owner, pool: account.pool,
    position: account.position, openOrders: account.openOrders, margin: account.marginUnlocked },
  indexed: history.rows.find(row => row.id === orderId.toString()) ?? null,
  priorPosition: { sizeBtc: '0.05416', source: 'M5.3 live account read, before placement',
    note: 'The pre-existing position belongs to Wallet 1; only the 0.00013 BTC change matches this order.' },
  limitations: ['Current position and free margin can change after this read.',
    'Indexer status can lag the chain; receipt events and on-chain open orders are decisive.',
    'No cancellation or reduce-only position close transaction is implied.'] };
const output = `${JSON.stringify(evidence, null, 2)}\n`;
if (process.argv.includes('--write')) {
  const directory = resolve('docs/evidence');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'verified-delegated-btc-order.json'), output,
    { encoding: 'utf8', flag: 'wx' });
}
console.log(output);
