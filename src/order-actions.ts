import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, encodeFunctionData, getAddress, http, parseAbi, parseUnits,
  toFunctionSelector, type Address, type Hex } from 'viem';
import { sha256 } from './evidence.ts';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC, readRpcHead } from './rpc-health.ts';
import { BTC_POOL, HIDEKI_MARGIN_BANK, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';
import { classifySimulationFailure, type SimulationFailure } from './preflight-failure.ts';
import { MAX_GAS_COST_WEI, MAX_GAS_LIMIT } from './delegated-plan.ts';

export const ORDER_ACTION_ABI = parseAbi([
  'function cancelOrderFor(address owner,uint128 orderId)',
  'function reduceOrderFor(address owner,uint128 orderId,uint256 newQuantityRemaining)',
]);
if (toFunctionSelector(ORDER_ACTION_ABI[0]!) !== '0xe37b444b' ||
  toFunctionSelector(ORDER_ACTION_ABI[1]!) !== '0x364c2587')
  throw Error('Official order action selectors mismatch');
export type OrderAction = 'CANCEL' | 'REDUCE_ORDER';
export type OrderSnapshot = { block: string; id: string; owner: string; pool: string;
  side: 'BUY' | 'SELL'; priceRaw: string; fullRaw: string; remainingRaw: string;
  expiryNs: string; active: boolean; positionRaw: string; entryPriceRaw: string };
export type OrderActionObservation = { observedAt: string; chainId: number; owner: string;
  operator: string; pool: string; snapshot: OrderSnapshot | null; gasWei: string;
  permission: 'SUPPORTED' | 'BLOCKED' | 'UNKNOWN'; market: 'SUPPORTED' | 'BLOCKED' | 'UNKNOWN';
  lotRaw: string; minRaw: string; nowSeconds: string; estimatedGas: string | null;
  gasPriceWei: string | null; simulationFailure: SimulationFailure | null };
export type OrderActionPlan = { schema: 'perp-canary/order-action-plan/v1';
  status: 'PREPARED' | 'BLOCKED'; operation: OrderAction; chainId: 50383;
  owner: string; operator: string; pool: string; orderId: string;
  before: OrderSnapshot | null; newRemainingRaw: string | null; observedAt: string;
  expiresAt: string; intentId: string;
  transaction: { from: string; to: string; data: Hex; value: '0' } | null;
  risk: { gasLimit: string; estimatedGas: string; gasPriceWei: string; maxGasCostWei: string };
  checks: { chain: boolean; owner: boolean; active: boolean; permission: boolean;
    market: boolean; quantity: boolean; gas: boolean; simulation: boolean; fresh: boolean;
    targetAndCalldata: boolean }; blockers: string[]; hash: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function orderActionData(operation: OrderAction, owner: string, id: string,
  newRemainingRaw: string | null): Hex {
  if (operation === 'CANCEL') return encodeFunctionData({ abi: ORDER_ACTION_ABI,
    functionName: 'cancelOrderFor', args: [getAddress(owner), BigInt(id)] });
  if (newRemainingRaw === null) throw Error('New remaining quantity required');
  return encodeFunctionData({ abi: ORDER_ACTION_ABI, functionName: 'reduceOrderFor',
    args: [getAddress(owner), BigInt(id), BigInt(newRemainingRaw)] });
}
export async function discoverBtcOrders() {
  const head = await readRpcHead();
  const owner = getAddress(OWNER_TRADING_WALLET);
  const pool = getAddress(BTC_POOL);
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, async () => {
    const rows = await sdk.client.getOpenOrdersOnchain([pool], owner,
      { blockNumber: BigInt(head.blockNumber) });
    const ref = { marginBank: getAddress(HIDEKI_MARGIN_BANK.toLowerCase()), account: owner, pool };
    const position = await sdk.client.getPerpPosition(ref);
    const [analytics, liquidation] = await Promise.all([
      sdk.client.getPerpPositionAnalytics(ref).catch(() => null),
      sdk.client.getLiquidationPrice(ref).catch(() => null),
    ]);
    return { chainId: head.chainId, block: rows.blockNumber.toString(), owner, pool,
      position: { sizeRaw: position.size.toString(), entryPriceRaw: position.avgEntryPrice.toString(),
        markPriceRaw: analytics?.priceable ? analytics.markPrice.toString() : null,
        pnlRaw: analytics?.priceable ? analytics.unrealizedPnl.toString() : null,
        analyticsBlock: analytics?.asOfBlock.toString() ?? null,
        liquidationPriceRaw: liquidation?.toString() ?? null },
      orders: rows.orders.map(row => ({ block: rows.blockNumber.toString(), id: row.orderId.toString(),
        owner: row.owner, pool: row.pool, side: row.isBid ? 'BUY' as const : 'SELL' as const,
        priceRaw: row.price.toString(), fullRaw: row.fullQuantity.toString(),
        remainingRaw: row.quantityRemaining.toString(), expiryNs: row.expireTimestampNs.toString(),
        active: true, positionRaw: position.size.toString(),
        entryPriceRaw: position.avgEntryPrice.toString() })) };
  }, () => 'reading live BTC-PERP orders and position', 45_000);
}
export async function inspectOrderAction(operation: OrderAction, orderId: string,
  newRemainingRaw: string | null, operator: string): Promise<OrderActionObservation> {
  if (!/^\d+$/.test(orderId) || BigInt(orderId) <= 0n || BigInt(orderId) >= 2n ** 128n)
    throw Error('Order ID must be a positive uint128');
  const discovery = await discoverBtcOrders();
  const snapshot = discovery.orders.find(row => row.id === BigInt(orderId).toString()) ?? null;
  if (!snapshot) throw Error('No live Wallet 1 BTC-PERP order with this ID');
  const auth = await inspectTradingAuthorization({ tradingWallet: discovery.owner, operator,
    pool: discovery.pool });
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  const { market, exact } = await withSnapshotSdk(sdk, controller, async () => {
    const [markets, exact] = await Promise.all([
      sdk.client.listPerpMarkets(), sdk.client.getOrderOnchain(getAddress(BTC_POOL), BigInt(orderId),
        { blockNumber: BigInt(discovery.block) }),
    ]);
    return { market: markets.find(row => same(row.poolAddress, discovery.pool)) ?? null, exact };
  },
  () => 'reading BTC-PERP order grid', 45_000);
  if (!exact || !same(exact.owner, snapshot.owner) ||
    exact.quantityRemaining.toString() !== snapshot.remainingRaw ||
    exact.fullQuantity.toString() !== snapshot.fullRaw ||
    exact.price.toString() !== snapshot.priceRaw ||
    exact.isBid !== (snapshot.side === 'BUY'))
    throw Error('Pinned on-chain order ID disagrees with Wallet 1 open-order list');
  const client = createPublicClient({ chain: hidekiTestnet,
    transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
  const block = await client.getBlock({ blockNumber: BigInt(discovery.block) });
  const data = orderActionData(operation, discovery.owner, snapshot.id, newRemainingRaw);
  let estimatedGas: bigint | null = null;
  let simulationFailure: SimulationFailure | null = null;
  try { estimatedGas = await client.estimateGas({ account: getAddress(operator), to: discovery.pool as Address,
    data, value: 0n }); }
  catch (error) { simulationFailure = classifySimulationFailure(error); }
  const gasPrice = estimatedGas !== null ? await client.getGasPrice().catch(() => null) : null;
  return { observedAt: new Date().toISOString(), chainId: discovery.chainId,
    owner: discovery.owner, operator: getAddress(operator), pool: discovery.pool,
    snapshot, gasWei: parseUnits(auth.operatorGasStt === 'UNKNOWN' ? '0' : auth.operatorGasStt, 18).toString(),
    permission: auth.permissions[operation === 'CANCEL' ? 'cancel' : 'reduce'].effective.status,
    market: auth.marketSupported.status, lotRaw: market?.lotSize ?? '0',
    minRaw: market?.minQuantity ?? '0', nowSeconds: block.timestamp.toString(),
    estimatedGas: estimatedGas?.toString() ?? null, gasPriceWei: gasPrice?.toString() ?? null,
    simulationFailure };
}
export function buildOrderActionPlan(observation: OrderActionObservation, operation: OrderAction,
  orderId: string, newRemainingRaw: string | null, now = Date.now()): OrderActionPlan {
  const before = observation.snapshot;
  const id = BigInt(orderId).toString();
  const expiry = new Date(now + 120_000).toISOString();
  let quantity = operation === 'CANCEL' && newRemainingRaw === null;
  if (operation === 'REDUCE_ORDER' && before && newRemainingRaw && /^\d+$/.test(newRemainingRaw)) {
    const next = BigInt(newRemainingRaw);
    const old = BigInt(before.remainingRaw);
    const lot = BigInt(observation.lotRaw);
    const min = BigInt(observation.minRaw);
    quantity = next >= min && next < old && lot > 0n && next % lot === 0n &&
      (before.expiryNs === '0' || BigInt(before.expiryNs) > BigInt(observation.nowSeconds) * 1_000_000_000n);
  }
  const estimate = BigInt(observation.estimatedGas ?? '0');
  const gasPrice = BigInt(observation.gasPriceWei ?? '0');
  const gasLimit = estimate * 125n / 100n + 100_000n;
  const gasCost = gasLimit * gasPrice;
  const data = before ? orderActionData(operation, observation.owner, id, newRemainingRaw) : null;
  const checks = { chain: observation.chainId === 50383,
    owner: !!before && same(before.owner, OWNER_TRADING_WALLET) && same(before.pool, BTC_POOL) && before.id === id,
    active: !!before && before.active && BigInt(before.remainingRaw) > 0n,
    permission: observation.permission === 'SUPPORTED', market: observation.market === 'SUPPORTED',
    quantity, gas: estimate > 0n && gasPrice > 0n && gasLimit <= MAX_GAS_LIMIT &&
      gasCost <= MAX_GAS_COST_WEI && BigInt(observation.gasWei) >= gasCost,
    simulation: observation.estimatedGas !== null && observation.simulationFailure === null,
    fresh: now >= Date.parse(observation.observedAt) && now - Date.parse(observation.observedAt) <= 30_000,
    targetAndCalldata: data !== null && same(observation.pool, BTC_POOL) &&
      same(observation.owner, OWNER_TRADING_WALLET) };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => `${name} gate failed`);
  if (observation.simulationFailure) blockers.unshift(`${observation.simulationFailure.category}: ${observation.simulationFailure.contractError ?? observation.simulationFailure.details}`);
  const body = { schema: 'perp-canary/order-action-plan/v1' as const,
    status: blockers.length ? 'BLOCKED' as const : 'PREPARED' as const,
    operation, chainId: 50383 as const, owner: getAddress(OWNER_TRADING_WALLET),
    operator: observation.operator, pool: getAddress(BTC_POOL), orderId: id, before,
    newRemainingRaw, observedAt: observation.observedAt, expiresAt: expiry,
    intentId: sha256({ operation, owner: OWNER_TRADING_WALLET.toLowerCase(),
      operator: observation.operator.toLowerCase(), pool: BTC_POOL.toLowerCase(), id,
      newRemainingRaw }),
    transaction: data ? { from: observation.operator, to: observation.pool,
      data, value: '0' as const } : null,
    risk: { gasLimit: gasLimit.toString(), estimatedGas: estimate.toString(),
      gasPriceWei: gasPrice.toString(), maxGasCostWei: gasCost.toString() }, checks, blockers };
  return { ...body, hash: sha256(body) };
}
export function verifyOrderActionPlan(plan: OrderActionPlan): void {
  const { hash, ...body } = plan;
  const expectedIntent = sha256({ operation: plan.operation, owner: OWNER_TRADING_WALLET.toLowerCase(),
    operator: plan.operator.toLowerCase(), pool: BTC_POOL.toLowerCase(), id: plan.orderId,
    newRemainingRaw: plan.newRemainingRaw });
  if (plan.schema !== 'perp-canary/order-action-plan/v1' || hash !== sha256(body) ||
    !['CANCEL', 'REDUCE_ORDER'].includes(plan.operation) || plan.chainId !== 50383 ||
    !same(plan.owner, OWNER_TRADING_WALLET) || !same(plan.pool, BTC_POOL) ||
    plan.intentId !== expectedIntent ||
    (plan.status === 'PREPARED' && (!plan.before || !plan.transaction ||
      plan.blockers.length > 0 || Object.values(plan.checks).some(value => !value) ||
      (plan.operation === 'CANCEL' && plan.newRemainingRaw !== null) ||
      (plan.operation === 'REDUCE_ORDER' && (!plan.newRemainingRaw ||
        BigInt(plan.newRemainingRaw) <= 0n ||
        BigInt(plan.newRemainingRaw) >= BigInt(plan.before.remainingRaw))) ||
      plan.before.id !== plan.orderId || !same(plan.before.owner, plan.owner) ||
      !same(plan.before.pool, plan.pool) ||
      !same(plan.transaction.from, plan.operator) || !same(plan.transaction.to, plan.pool) ||
      plan.transaction.value !== '0' ||
      BigInt(plan.risk.gasLimit) <= 0n || BigInt(plan.risk.gasPriceWei) <= 0n ||
      BigInt(plan.risk.gasLimit) > MAX_GAS_LIMIT || BigInt(plan.risk.maxGasCostWei) > MAX_GAS_COST_WEI ||
      BigInt(plan.risk.maxGasCostWei) !== BigInt(plan.risk.gasLimit) * BigInt(plan.risk.gasPriceWei) ||
      Date.parse(plan.expiresAt) - Date.parse(plan.observedAt) > 150_000 ||
      plan.transaction.data !== orderActionData(plan.operation, plan.owner, plan.orderId, plan.newRemainingRaw))))
    throw Error('Order action plan integrity or allowlist failure');
}
