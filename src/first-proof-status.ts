import { parseUnits } from 'viem';
import { decodeKnownLogs, BTC_POOL, type TradeEvent } from './trade-forensics.ts';
import type { PreparedPlan } from './delegated-plan.ts';
import type { ProofResult, ProofSnapshot } from './canary-proof.ts';
import type { discoverBtcOrders } from './order-actions.ts';

export type OrderDiscovery = Awaited<ReturnType<typeof discoverBtcOrders>>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function summarizeFirstProofStatus(plan: PreparedPlan, proof: ProofResult,
  snapshot: ProofSnapshot | null, discovery: OrderDiscovery | null) {
  const receipt = snapshot?.receipt ?? null;
  const decoded = receipt ? decodeKnownLogs(receipt) : { events: [] as TradeEvent[], unknownLogCount: 0 };
  const events = decoded.events.filter(event => same(event.address, BTC_POOL) &&
    ['OrderPlaced', 'OrderRested', 'OrderFilled', 'OrderCancelled'].includes(event.eventName));
  const placed = events.filter(event => event.eventName === 'OrderPlaced' &&
    same(String((event.args.placedOrder as { owner?: unknown } | undefined)?.owner ?? ''), plan.owner) &&
    String((event.args.placedOrder as { price?: unknown } | undefined)?.price) === parseUnits(plan.price, 18).toString() &&
    String((event.args.placedOrder as { fullQuantity?: unknown } | undefined)?.fullQuantity) ===
      parseUnits(plan.quantity, 8).toString());
  const orderId = proof.verdict === 'VERIFIED' && proof.classification === 'ONCHAIN_SUCCESS' &&
    placed.length === 1 ? String(placed[0]!.args.orderId) : null;
  const matchingDiscovery = discovery && receipt && BigInt(discovery.block) >= BigInt(receipt.blockNumber) &&
    discovery.chainId === 50383 && same(discovery.owner, plan.owner) && same(discovery.pool, plan.pool);
  const current = matchingDiscovery && orderId ?
    discovery.orders.find(order => order.id === orderId && same(order.owner, plan.owner) &&
      same(order.pool, plan.pool)) : null;
  const currentOrderState = !receipt || !orderId || !matchingDiscovery ? 'UNKNOWN' :
    current ? 'OPEN_AT_READ' : 'NOT_OPEN_AT_READ';
  return { planHash: plan.hash, txHash: proof.txHash,
    verification: proof.verdict, outcome: proof.outcome, classification: proof.classification,
    receipt: receipt ? { status: receipt.status, blockNumber: receipt.blockNumber,
      transactionHash: receipt.transactionHash, gasUsed: receipt.gasUsed } : null,
    events, unknownLogCount: decoded.unknownLogCount, orderId,
    currentOrderState, orderReadBlock: matchingDiscovery ? discovery.block : null,
    remainingRaw: current?.remainingRaw ?? null,
    positionRawAtOrderRead: matchingDiscovery ? discovery.position.sizeRaw : null,
    nextAction: currentOrderState === 'OPEN_AT_READ' ?
      'If you decide to cancel, use dashboard Execution Control to prepare a separate owner-approved CANCEL plan for this BTC-PERP order ID. Recheck live state first.' :
      currentOrderState === 'NOT_OPEN_AT_READ' ?
        'Order is not in the current open-order list; inspect fills/cancel/expiry before any new action.' :
        'Insufficient current order evidence; do not assume OrderRested means still open and do not retry an uncertain broadcast.' };
}
