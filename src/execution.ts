export type Operation = 'PLACE' | 'CANCEL' | 'CLOSE';
export type IntegrityVerdict = 'GREEN' | 'AMBER' | 'RED';

export interface ExecutionPlan {
  schema: 'perp-canary/plan/v1';
  tier: 'LIVE';
  observedAt: string;
  chainId: 50383;
  operation: Operation;
  account: string;
  pool: string;
  marginBank: string;
  symbol: string;
  baseline: { blockNumber: string; positionSize: string; feedGate: string; markPrice: string | null;
    consistency: 'SEQUENTIAL_READS_NOT_PINNED' };
  request: { isBid: boolean | null; price: string | null; quantity: string | null; orderId: string | null;
    orderType?: 2 | null };
  preview: Record<string, unknown> | null;
  wallet?: { gasWei: string; gasSTT: string; collateralToken: string; walletCollateral: string;
    walletCollateralHuman: string; unlockedMarginHuman: string;
    margin: Record<string, unknown>; voucherEligibility: unknown; whitelist: 'NOT_VERIFIED';
    estimatedGas: string | null; gasLimit: string | null; estimatedGasCostWei: string | null };
  unsigned?: { chainId: 50383; to: string; data: string; value: string; description: string };
  blockers: string[];
  warnings: string[];
  method: 'placePerpOrder' | 'cancelOrder';
  sendEnabled: false;
}

export interface ReceiptObservation {
  tier: 'LIVE';
  txHash: string;
  chainId: number;
  status: 'success' | 'reverted';
  from: string;
  to: string | null;
  call: { method: 'placeOrder' | 'cancelOrder'; isBid?: boolean; price?: string;
    quantity?: string; orderId?: string; orderType?: number } | null;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice: string | null;
  placedOrderIds: string[];
  foreignOrderEvents: number;
  cancelledOrderIds: string[];
  fills: { quantity: string; price: string; takerOrderId: string }[];
  positionEvents: { account: string; pool: string; newSize: string }[];
  postPositionSize: string | null;
  unknownLogs: number;
}

export interface IntegrityAssessment {
  verdict: IntegrityVerdict;
  reasons: string[];
  expected: { quantity: string | null; limitPrice: string | null; positionSize: string };
  actual: { filledQuantity: string; weightedFillPrice: string | null; positionEventSize: string | null;
    currentPositionSize: string | null; protocolFee: 'NOT_MEASURED'; slippage: 'NOT_MEASURED' };
}

export function assessExecution(plan: ExecutionPlan, receipt: ReceiptObservation): IntegrityAssessment {
  const red: string[] = [];
  const amber: string[] = [];
  if (plan.blockers.length) amber.push('Plan had blockers before execution');
  if (receipt.chainId !== 50383) red.push('Receipt came from the wrong chain');
  if (receipt.status === 'reverted') red.push('Transaction reverted');
  if (receipt.to?.toLowerCase() !== plan.pool.toLowerCase()) {
    if (receipt.placedOrderIds.length || receipt.fills.length || receipt.positionEvents.length)
      amber.push('Contract-mediated route has pool or MarginBank activity, but inner call and signer are not verified');
    else red.push('Transaction target differs from planned pool');
  }
  if (!receipt.call) amber.push('Pool transaction calldata could not be decoded as a supported order action');
  else if (plan.operation === 'CANCEL') {
    if (receipt.call.method !== 'cancelOrder' || receipt.call.orderId !== plan.request.orderId) {
      red.push('Transaction cancellation call differs from the planned order ID');
    }
  } else if (receipt.call.method !== 'placeOrder' || receipt.call.isBid !== plan.request.isBid ||
    receipt.call.price !== plan.request.price || receipt.call.quantity !== plan.request.quantity ||
    (plan.request.orderType !== undefined && plan.request.orderType !== null && receipt.call.orderType !== plan.request.orderType)) {
    red.push('Transaction placement calldata differs from planned side, price, quantity or order type');
  }
  if (receipt.from.toLowerCase() !== plan.account.toLowerCase()) amber.push('Sender differs from plan account; linked-wallet authority is not verified');
  if (BigInt(receipt.blockNumber) < BigInt(plan.baseline.blockNumber)) red.push('Receipt predates the plan baseline');
  if (receipt.foreignOrderEvents) amber.push('Receipt contains order events owned by another account');
  const filled = receipt.fills.reduce((sum, fill) => sum + BigInt(fill.quantity), 0n);
  const weighted = filled > 0n ? receipt.fills.reduce((sum, fill) => sum + BigInt(fill.quantity) * BigInt(fill.price), 0n) / filled : null;
  const positionEvents = receipt.positionEvents.filter(event => event.account.toLowerCase() === plan.account.toLowerCase()
    && event.pool.toLowerCase() === plan.pool.toLowerCase());
  const positionEvent = positionEvents.at(-1)?.newSize ?? null;

  if (plan.operation === 'CANCEL') {
    if (!receipt.cancelledOrderIds.includes(plan.request.orderId ?? '')) {
      amber.push('Expected OrderCancelled event was not observed');
    }
  } else {
    const requested = BigInt(plan.request.quantity ?? '0');
    if (filled > requested) red.push('Filled quantity exceeds the planned quantity');
    if (filled === 0n && receipt.placedOrderIds.length === 0) amber.push('No fill or resting-order event observed');
    if (filled > 0n && receipt.placedOrderIds.length === 0) amber.push('Fill cannot be tied to an owned OrderPlaced event');
    if (receipt.fills.some(fill => !receipt.placedOrderIds.includes(fill.takerOrderId))) amber.push('Fill taker order ID is not tied to the planned account');
    if (plan.operation === 'CLOSE' && filled === 0n) amber.push('No closing fill observed');
    const limit = BigInt(plan.request.price ?? '0');
    if (receipt.fills.some(fill => plan.request.isBid ? BigInt(fill.price) > limit : BigInt(fill.price) < limit)) {
      red.push('A fill price breached the planned limit');
    }
    if (positionEvent !== null && filled > 0n) {
      const expectedSize = BigInt(plan.baseline.positionSize) + (plan.request.isBid ? filled : -filled);
      if (BigInt(positionEvent) !== expectedSize) amber.push('PositionUpdated differs from the earlier baseline; intervening state changes are possible');
    } else if (filled > 0n) amber.push('PositionUpdated event was not observed for the account and pool');
  }
  if (filled > 0n && receipt.postPositionSize === null) amber.push('Current post-transaction position could not be read');
  if (positionEvent !== null && receipt.postPositionSize !== null && positionEvent !== receipt.postPositionSize) {
    amber.push('Current position differs from receipt event; later state changes are possible');
  }
  if (receipt.unknownLogs) amber.push(`${receipt.unknownLogs} receipt logs were not decoded by the supported ABIs`);
  const verdict: IntegrityVerdict = red.length ? 'RED' : amber.length ? 'AMBER' : 'GREEN';
  return { verdict, reasons: [...red, ...amber, ...(verdict === 'GREEN' ? ['Observed receipt events match the bounded plan'] : [])],
    expected: { quantity: plan.request.quantity, limitPrice: plan.request.price, positionSize: plan.baseline.positionSize },
    actual: { filledQuantity: filled.toString(), weightedFillPrice: weighted?.toString() ?? null,
      positionEventSize: positionEvent, currentPositionSize: receipt.postPositionSize,
      protocolFee: 'NOT_MEASURED', slippage: 'NOT_MEASURED' } };
}
