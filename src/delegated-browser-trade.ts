import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, formatUnits, getAddress, http,
  isAddress, parseAbi, parseUnits, toFunctionSelector, type Address, type Hex } from 'viem';
import { assessDirectTrade, readDirectAccount, type DirectInput, type TradeObservation } from './browser-trade.ts';
import { withSnapshotSdk } from './lifecycle.ts';
import { readVerifiedMarket, verifiedMarket } from './market-registry.ts';
import { RPC } from './rpc-health.ts';
import { HIDEKI_BANK, KNOWN_EMBEDDED } from './wallet-funding.ts';
import { TradeStageError, TradeUserError, tradeStage } from './trade-stage.ts';
import { decodeExecutionError } from './execution-error-decoder.ts';

export const DELEGATED_PLACE_ABI = parseAbi([
  'function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool success,uint128 orderId)',
]);
export const DELEGATED_CANCEL_ABI = parseAbi(['function cancelOrderFor(address owner,uint128 orderId)']);
export class OrderNotOpenError extends Error {
  readonly code = 'ORDER_NOT_OPEN';
  readonly orderId: string;
  readonly owner: string;
  readonly market: string;
  readonly block: string;
  constructor(orderId: string, owner: string, market: string, block: string) {
    super(`Order #${orderId} is no longer open for Wallet 1 on ${market} at on-chain block ${block}. ` +
      'It may have filled, expired or been cancelled. Refresh open orders and load indexed history; do not send a stale cancellation.');
    this.name = 'OrderNotOpenError';
    this.orderId = orderId; this.owner = owner; this.market = market; this.block = block;
  }
}
export function requireOpenDelegatedOrder(account: { owner: string; market: string; block: string;
  openOrders: Array<{ id: string }> }, orderId: string) {
  if (account.owner.toLowerCase() !== KNOWN_EMBEDDED.toLowerCase())
    throw Error('Cancellation margin owner differs from verified Wallet 1');
  const order = account.openOrders.find(row => row.id === orderId);
  if (!order) throw new OrderNotOpenError(orderId, account.owner, account.market, account.block);
  return order;
}
const permissionAbi = parseAbi([
  'function getOperatorPermissionsRegistry() view returns (address)',
  'function isOperatorAuthorized(address owner,address operator,bytes4 selector) view returns (bool)',
]);
const REGISTRY = getAddress('0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a');
const PLACE = toFunctionSelector(DELEGATED_PLACE_ABI[0]!);
const CANCEL = toFunctionSelector(DELEGATED_CANCEL_ABI[0]!);
const REDUCE = '0x364c2587' as const;
if (PLACE !== '0x80054449' || CANCEL !== '0xe37b444b') throw Error('Delegated selectors differ from verified pool ABI');
const ZERO = '0x0000000000000000000000000000000000000000';
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
const checked = (value: string): Address => {
  if (!isAddress(value, { strict: false })) throw Error('Valid connected operator address required');
  return getAddress(value);
};
async function withSdk<T>(work: (sdk: SomniaMarkets) => Promise<T>, timeoutMs = 45_000): Promise<T> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, () => work(sdk), () => 'reading delegated perps account', timeoutMs);
}
export async function readDelegatedAccount(rawOperator: string, marketId = 'BTC-PERP') {
  const operator = checked(rawOperator);
  const selected = await tradeStage('market registry', () => verifiedMarket(marketId));
  const [registry, place, cancel, reduce, gas, ownerAccount] = await Promise.all([
    tradeStage('operator permission registry', () => client.readContract({ address: selected.pool, abi: permissionAbi,
      functionName: 'getOperatorPermissionsRegistry' })),
    tradeStage('placeOrderFor grant', () => client.readContract({ address: selected.pool, abi: permissionAbi,
      functionName: 'isOperatorAuthorized', args: [KNOWN_EMBEDDED, operator, PLACE] })),
    tradeStage('cancelOrderFor grant', () => client.readContract({ address: selected.pool, abi: permissionAbi,
      functionName: 'isOperatorAuthorized', args: [KNOWN_EMBEDDED, operator, CANCEL] })),
    tradeStage('reduceOrderFor grant', () => client.readContract({ address: selected.pool, abi: permissionAbi,
      functionName: 'isOperatorAuthorized', args: [KNOWN_EMBEDDED, operator, REDUCE] })),
    tradeStage('operator STT balance', () => client.getBalance({ address: operator })),
    tradeStage('Wallet 1 MarginBank account and position', () => readDirectAccount(KNOWN_EMBEDDED, selected.id)),
  ]);
  if (registry.toLowerCase() !== REGISTRY.toLowerCase() ||
    ownerAccount.marginBank.toLowerCase() !== HIDEKI_BANK.toLowerCase())
    throw Error('Pool operator registry or owner MarginBank differs from official Hideki deployment');
  return { mode: 'DELEGATED_PERPS' as const, account: operator, operator, owner: KNOWN_EMBEDDED,
    chainId: ownerAccount.chainId, block: ownerAccount.block, observedAt: new Date().toISOString(),
    market: selected.symbol, marketId: selected.id, pool: selected.pool,
    marginBank: ownerAccount.marginBank, registry,
    permissions: { place, cancel, reduce, scope: `This owner and ${selected.symbol} pool; effective flags can be revoked at any time` },
    gasStt: formatUnits(gas, 18), gasWei: gas.toString(),
    marginUnlocked: ownerAccount.marginUnlocked, marginUnlockedRaw: ownerAccount.marginUnlockedRaw,
    withdrawable: ownerAccount.withdrawable,
    position: ownerAccount.position, openOrders: ownerAccount.openOrders,
    ownerWalletUsdso: ownerAccount.walletUsdso,
    note: 'Operator EOA pays gas. Orders and MarginBank balance belong to the dreamDEX smart account. No withdrawal grant.' };
}
export type DelegatedInput = DirectInput & { mode: 'DELEGATED_PERPS'; owner: string };
export function delegatedGate(input: DelegatedInput, owner: string, placeAuthorized: boolean): string[] {
  const blockers: string[] = [];
  if (input.mode !== 'DELEGATED_PERPS' || input.owner.toLowerCase() !== owner.toLowerCase() ||
    owner.toLowerCase() !== KNOWN_EMBEDDED.toLowerCase()) blockers.push('Delegated owner differs from verified Wallet 1');
  if (!placeAuthorized) blockers.push('No effective placeOrderFor grant for this operator and pool');
  return blockers;
}
export async function prepareDelegatedTrade(input: DelegatedInput) {
  const operator = checked(input.account);
  const marketId = input.market ?? 'BTC-PERP';
  const [selected, account] = await Promise.all([
    tradeStage('market registry', () => verifiedMarket(marketId, true)),
    tradeStage('delegated operator and Wallet 1 account', () => readDelegatedAccount(operator, marketId)),
  ]);
  let price = 0n;
  if (/^\d+(?:\.\d+)?$/.test(input.price)) {
    try { price = parseUnits(input.price, selected.quoteDecimals); }
    catch { throw new TradeUserError(`Limit price exceeds the ${selected.quoteDecimals}-decimal exchange precision.`); }
  }
  const max = price > 0n ? await tradeStage('Wallet 1 maximum placeable size', () => withSdk(async sdk => sdk.client.getMaxPerpOrderSize({
    pool: selected.pool, marginBank: selected.marginBank,
    account: KNOWN_EMBEDDED, isBid: input.side === 'BUY', price, autoPull: false }))).catch(() => null) : null;
  const market = await tradeStage('fresh selected-market book and metadata', () => readVerifiedMarket(marketId, true));
  const observation: TradeObservation = { chainId: market.chainId, observedAt: market.observedAt,
    block: market.block, pool: account.pool, expectedPool: market.market.pool, marginBank: account.marginBank,
    book: market.book, depth: market.depth, mark: market.mark, grid: market.grid,
    account: { address: operator, gasWei: account.gasWei, walletUsdsoRaw: '0',
      marginUnlockedRaw: account.marginUnlockedRaw,
      maxQuantityRaw: max?.priceable ? max.maxQuantity.toString() : null,
      maxPriceable: max?.priceable ?? false, maxPlaceable: !!max?.priceable && max.placeable,
      limitedBy: max?.priceable ? max.limitedBy : max ? 'STALE_MARK' : 'MAX_SIZE_READ_UNAVAILABLE' } };
  const base = assessDirectTrade(input, observation);
  const blockers = [...base.blockers, ...delegatedGate(input, account.owner, account.permissions.place)];
  const guard = { ...base, blockers,
    warnings: [...base.warnings, 'Delegated operator can place and cancel for Wallet 1; all margin remains with Wallet 1.'],
    verdict: blockers.length ? 'RED' as const : 'AMBER' as const };
  if (blockers.length || !guard.priceRaw || !guard.quantityRaw)
    return { status: 'BLOCKED' as const, guard, observation, account, transaction: null };
  const preview = await tradeStage('Wallet 1 margin preview', () => withSdk(async sdk => sdk.client.previewPerpOrderMargin({
    pool: market.market.pool, marginBank: market.market.marginBank, account: KNOWN_EMBEDDED,
    isBid: input.side === 'BUY', price: BigInt(guard.priceRaw!), quantity: BigInt(guard.quantityRaw!), autoPull: false })));
  const marginReasons = !preview.priceable ? ['Current mark is stale or unavailable; margin cannot be priced.'] : [
    !preview.hasCollateralForLock ? 'Wallet 1 free MarginBank collateral cannot cover this order lock; delegated calls cannot auto-pull.' : null,
    !preview.meetsInitialMargin ? 'Wallet 1 equity would not meet initial margin after this order.' : null,
    preview.voucherBlocked ? 'Paper USDso voucher rules block increasing this market position.' : null,
    preview.restrictedBlocked ? 'Market is close-only for increasing orders.' : null,
    preview.isolationBlocked ? 'Wallet 1 isolated account is bound to another market.' : null,
  ].filter((reason): reason is string => reason !== null);
  if (preview.priceable && !preview.sufficient && marginReasons.length === 0)
    marginReasons.push('SDK margin preview rejected this exact Wallet 1 order; refresh account and market evidence.');
  const marginPreview = { status: preview.priceable ? 'OK' as const : 'UNPRICEABLE' as const,
    sufficient: preview.priceable && preview.sufficient,
    lockUsdso: preview.priceable ? formatUnits(preview.lockAmount, 18) : null,
    initialRequirementUsdso: preview.priceable ? formatUnits(preview.imRequirement, 18) : null,
    topUpUsdso: preview.priceable ? formatUnits(preview.topUpRequired, 18) : null,
    reasons: marginReasons,
    asOfBlock: preview.asOfBlock.toString() };
  if (!marginPreview.sufficient) return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
      ...marginReasons] },
    observation, account, marginPreview, transaction: null };
  const now = Date.now(), expiresAt = input.expiresAt ?? now + 300_000;
  if (!Number.isInteger(expiresAt) || expiresAt < now + 30_000 || expiresAt > now + 300_000)
    throw Error('Order expiry must remain within the 300-second safety window');
  const data = encodeFunctionData({ abi: DELEGATED_PLACE_ABI, functionName: 'placeOrderFor', args: [
    KNOWN_EMBEDDED, input.side === 'BUY', 0n, BigInt(guard.priceRaw), BigInt(guard.quantityRaw),
    BigInt(expiresAt) * 1_000_000n, 3, 0, ZERO, 0n] });
  let estimated: bigint;
  try { estimated = await client.estimateGas({ account: operator, to: market.market.pool, data, value: 0n }); }
  catch (error) {
    const decoded = decodeExecutionError(error, 'ESTIMATE_GAS');
    if (decoded.errorClass !== 'CONTRACT_REVERT')
      throw new TradeStageError('delegated contract simulation', 'READ_FAILED', true);
    return { status: 'BLOCKED' as const,
      guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
        `${decoded.rootCause}. ${decoded.safeNextAction}`] },
      observation, account, marginPreview, transaction: null };
  }
  const [gasPrice, nonce] = await Promise.all([
    tradeStage('Hideki gas price', () => client.getGasPrice()),
    tradeStage('operator pending nonce', () => client.getTransactionCount({ address: operator, blockTag: 'pending' })),
  ]);
  const gasLimit = estimated * 12n / 10n;
  const cost = gasLimit * gasPrice;
  if (cost > 10n ** 17n || cost > BigInt(account.gasWei)) return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
      'Delegated gas estimate exceeds operator STT balance or 0.1 STT safety cap'] },
    observation, account, marginPreview, transaction: null };
  return { status: 'READY' as const, guard, observation, account, marginPreview,
    transaction: { chainId: 50383, market: market.market.symbol, marketId,
      owner: KNOWN_EMBEDDED, from: operator, to: market.market.pool, data, value: '0x0' as const,
      gas: `0x${gasLimit.toString(16)}`, nonce, expiresAt: new Date(expiresAt).toISOString(),
      estimatedGas: estimated.toString(), maxGasCostStt: formatUnits(cost, 18) } };
}
export async function prepareDelegatedCancel(rawOperator: string, marketId: string, orderId: string) {
  const operator = checked(rawOperator);
  if (!/^\d+$/.test(orderId) || BigInt(orderId) <= 0n || BigInt(orderId) >= 2n ** 128n)
    throw Error('Valid open order ID required');
  const [market, account] = await Promise.all([verifiedMarket(marketId, true),
    readDelegatedAccount(operator, marketId)]);
  if (!account.permissions.cancel) throw Error('No effective cancelOrderFor grant for this operator and pool');
  requireOpenDelegatedOrder(account, orderId);
  const data = encodeFunctionData({ abi: DELEGATED_CANCEL_ABI, functionName: 'cancelOrderFor',
    args: [KNOWN_EMBEDDED, BigInt(orderId)] });
  const estimated = await client.estimateGas({ account: operator, to: market.pool, data, value: 0n });
  const [gasPrice, nonce] = await Promise.all([client.getGasPrice(),
    client.getTransactionCount({ address: operator, blockTag: 'pending' })]);
  const gasLimit = estimated * 12n / 10n, cost = gasLimit * gasPrice;
  if (cost > 10n ** 17n || cost > BigInt(account.gasWei)) throw Error('Cancel gas exceeds STT or 0.1 STT cap');
  return { status: 'READY' as const, mode: 'DELEGATED_PERPS' as const, orderId, owner: KNOWN_EMBEDDED,
    market: market.symbol, account, transaction: { chainId: 50383, from: operator, to: market.pool,
      data, value: '0x0' as const, gas: `0x${gasLimit.toString(16)}`, nonce,
      maxGasCostStt: formatUnits(cost, 18) } };
}
export async function readDelegatedReceipt(hash: string, rawOperator: string, marketId: string,
  action: 'PLACE' | 'CANCEL', expectedOrderId?: string, expectedData?: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
  const operator = checked(rawOperator), market = await verifiedMarket(marketId);
  const notFound = (error: unknown) => {
    if (error instanceof Error && /Transaction(NotFound|ReceiptNotFound)Error/.test(error.name)) return null;
    throw error;
  };
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: hash as Hex }).catch(notFound),
    client.getTransactionReceipt({ hash: hash as Hex }).catch(notFound),
  ]);
  if (!tx) return { state: 'PENDING' as const, hash };
  if (tx.from.toLowerCase() !== operator.toLowerCase() || tx.to?.toLowerCase() !== market.pool.toLowerCase() ||
    tx.value !== 0n || !tx.input.startsWith(action === 'PLACE' ? PLACE : CANCEL))
    throw Error('Delegated transaction sender, pool or method differs from review');
  if (expectedData && tx.input.toLowerCase() !== expectedData.toLowerCase())
    throw Error('On-chain calldata differs from reviewed delegated call');
  const call = decodeFunctionData({ abi: action === 'PLACE' ? DELEGATED_PLACE_ABI : DELEGATED_CANCEL_ABI,
    data: tx.input });
  if (String(call.args[0]).toLowerCase() !== KNOWN_EMBEDDED.toLowerCase())
    throw Error('Delegated transaction owner differs from Wallet 1');
  if (action === 'CANCEL' && String(call.args[1]) !== expectedOrderId)
    throw Error('Delegated cancellation order ID differs from review');
  if (action === 'PLACE' && (call.args[2] !== 0n || call.args[6] !== 3 || call.args[7] !== 0 ||
    String(call.args[8]).toLowerCase() !== ZERO || call.args[9] !== 0n))
    throw Error('Delegated order parameters differ from guarded PostOnly call');
  if (!receipt) return { state: 'PENDING' as const, hash };
  if (receipt.status !== 'success') return { state: 'FAILED' as const, hash, block: receipt.blockNumber.toString() };
  const events = receipt.logs.filter(log => log.address.toLowerCase() === market.pool.toLowerCase()).flatMap(log => {
    try { return [decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics })]; }
    catch { return []; }
  });
  if (action === 'CANCEL') {
    const found = events.some(event => event.eventName === 'OrderCancelled' &&
      String((event.args as { orderId?: bigint }).orderId) === expectedOrderId);
    return { state: found ? 'CANCELLED' as const : 'UNKNOWN' as const, hash,
      block: receipt.blockNumber.toString(), orderId: expectedOrderId,
      note: found ? 'Cancellation event observed; refresh current open orders.' : 'Matching cancel event absent.' };
  }
  const placed = events.find(event => event.eventName === 'OrderPlaced' &&
    String((event.args as { placedOrder?: { owner?: string } }).placedOrder?.owner).toLowerCase() ===
      KNOWN_EMBEDDED.toLowerCase());
  if (!placed) return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
    note: 'Matching Wallet 1 OrderPlaced event absent.' };
  const placedOrder = (placed.args as { placedOrder?: { isBid?: boolean; price?: bigint;
    fullQuantity?: bigint; expireTimestampNs?: bigint } }).placedOrder;
  if (!placedOrder || placedOrder.isBid !== call.args[1] || placedOrder.price !== call.args[3] ||
    placedOrder.fullQuantity !== call.args[4] || placedOrder.expireTimestampNs !== call.args[5])
    return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
      note: 'Wallet 1 OrderPlaced event differs from delegated calldata.' };
  const orderId = String((placed.args as { orderId?: bigint }).orderId);
  const rested = events.some(event => event.eventName === 'OrderRested' &&
    String((event.args as { orderId?: bigint }).orderId) === orderId);
  return { state: 'PLACED' as const, hash, block: receipt.blockNumber.toString(), orderId,
    outcomeAtPlacement: rested ? 'RESTED_AT_PLACEMENT' as const : 'UNKNOWN' as const,
    note: 'Placement receipt observed. Current open state or fill requires a fresh Wallet 1 read.' };
}

export async function readAccountOrderHistory(rawOperator: string, mode: 'DIRECT' | 'DELEGATED_PERPS',
  marketId: string, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw Error('Invalid history page offset');
  const operator = checked(rawOperator), market = await verifiedMarket(marketId);
  const owner = mode === 'DELEGATED_PERPS' ? KNOWN_EMBEDDED : operator;
  const rows = await withSdk(sdk => sdk.client.listPerpOrderHistory(owner,
    { pool: market.pool, limit: 20, offset, orderBy: 'ended' }), 20_000);
  return { mode, owner, market: market.symbol, observedAt: new Date().toISOString(),
    offset, nextOffset: rows.length === 20 && offset + 20 <= 1000 ? offset + 20 : null,
    source: 'OFFICIAL_SDK_INDEXER_NONFINAL', note: 'Indexer history can lag; receipt and on-chain open orders decide current state.',
    rows: rows.map(row => ({ id: row.orderId, side: row.isBid ? 'BUY' : 'SELL',
      price: formatUnits(BigInt(row.price), market.quoteDecimals),
      originalQuantity: formatUnits(BigInt(row.fullQuantity), market.baseDecimals),
      filledQuantity: formatUnits(BigInt(row.filledQuantity), market.baseDecimals),
      status: row.status, rested: row.rested, cancelReason: row.cancelReason,
      endedAt: new Date(Number(row.lastUpdatedAtTimestamp) * 1000).toISOString(),
      placedTxHash: row.placedTxHash })) };
}
