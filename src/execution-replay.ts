import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type ReplayEvidence = {
  schema: string; observedAt: string; chainId: number; orderId: string;
  placement: { hash: string; block: string; status: string; from: string; callOwner: string;
    price: string; quantity: string; isBid: boolean; to: string };
  fillReceipt: { hash: string; block: string; status: string; containsMatchingPoolLog: boolean };
  events: Array<{ name: string; block: string; transactionHash: string; orderId: string | null;
    makerOrderId: string | null; quantityFilled: string | null; makerRemaining: string | null; fillPrice: string | null }>;
  indexed: { id: string; status: string; filledQuantity: string; endedAt: string | null };
  priorPosition: { sizeBtc: string; note: string };
  current: { block: string; position: { size: string }; openOrders: unknown[] };
};

export function buildExecutionReplay(e: ReplayEvidence) {
  if (e.schema !== 'perp-canary/verified-delegated-btc-order/v1' || e.chainId !== 50383 ||
    e.indexed.id !== e.orderId || e.placement.status !== 'success' || e.fillReceipt.status !== 'success' ||
    !e.fillReceipt.containsMatchingPoolLog || !/^\d+$/.test(e.orderId))
    throw Error('Replay evidence identity or receipt status invalid');
  const placed = e.events.find(row => row.name === 'OrderPlaced' && row.orderId === e.orderId &&
    row.transactionHash.toLowerCase() === e.placement.hash.toLowerCase());
  const rested = e.events.find(row => row.name === 'OrderRested' && row.orderId === e.orderId);
  const filled = e.events.find(row => row.name === 'OrderFilled' && row.makerOrderId === e.orderId &&
    row.transactionHash.toLowerCase() === e.fillReceipt.hash.toLowerCase());
  if (!placed || !rested || !filled || filled.quantityFilled !== e.placement.quantity ||
    filled.makerRemaining !== '0' || filled.fillPrice !== e.placement.price ||
    e.indexed.status !== 'Filled' || e.indexed.filledQuantity !== e.placement.quantity)
    throw Error('Replay events do not prove this order fully filled');
  const steps = [
    { label: 'Intent', source: 'HISTORICAL_VERIFIED_CALLDATA', status: 'BUY_POST_ONLY',
      detail: `${e.placement.quantity} BTC at ${e.placement.price} USDso; operator ${e.placement.from}; owner ${e.placement.callOwner}`, block: null, hash: null },
    { label: 'Preflight and simulation', source: 'NOT_RECORDED_FOR_THIS_ORDER', status: 'UNAVAILABLE',
      detail: 'The saved bundle has no hash-bound preflight or simulation record for this exact order.', block: null, hash: null },
    { label: 'Wallet submission', source: 'LIVE_ON_CHAIN_RECEIPT', status: 'CONFIRMED',
      detail: 'The transaction sender and call are verified on-chain; the wallet prompt itself was not recorded.', block: e.placement.block, hash: e.placement.hash },
    { label: 'OrderPlaced', source: 'LIVE_ON_CHAIN_EVENT', status: 'CONFIRMED',
      detail: `Order #${e.orderId} owned by Wallet 1`, block: placed.block, hash: placed.transactionHash },
    { label: 'OrderRested', source: 'LIVE_ON_CHAIN_EVENT', status: 'CONFIRMED',
      detail: 'PostOnly order rested after placement', block: rested.block, hash: rested.transactionHash },
    { label: 'OrderFilled', source: 'LIVE_ON_CHAIN_EVENT', status: 'FULL_FILL',
      detail: `${filled.quantityFilled} BTC at ${filled.fillPrice} USDso; maker remainder 0`, block: filled.block, hash: filled.transactionHash },
    { label: 'Final indexer state', source: 'OFFICIAL_SDK_INDEXER_NONFINAL', status: e.indexed.status,
      detail: `Filled ${e.indexed.filledQuantity} BTC; indexed end ${e.indexed.endedAt ?? 'unknown'}`, block: null, hash: null },
    { label: 'Position observation', source: 'PRIOR_AND_LATER_LIVE_READ_ONLY', status: 'OBSERVED_DELTA',
      detail: `${e.priorPosition.sizeBtc} → ${e.current.position.size} BTC; only ${e.placement.quantity} BTC change matches this fill. The position existed before Perp Canary.`,
      block: e.current.block, hash: null },
  ];
  return { chainId: e.chainId, orderId: e.orderId, source: 'HISTORICAL_VERIFIED_BUNDLE',
    observedAt: e.observedAt, indexedEndedAt: e.indexed.endedAt, verifiedFillPrice: filled.fillPrice,
    operator: e.placement.from, owner: e.placement.callOwner,
    placementHash: e.placement.hash, fillHash: e.fillReceipt.hash, steps,
    limitation: 'This replay is a fixed historical evidence bundle. The current position and market may differ.' };
}

export async function readExecutionReplay(orderId: string) {
  if (orderId !== '14978756187852164141712') throw Error('No verified replay bundle for this order ID');
  const raw = await readFile(resolve('docs/evidence/verified-delegated-btc-order.json'), 'utf8');
  return buildExecutionReplay(JSON.parse(raw) as ReplayEvidence);
}
