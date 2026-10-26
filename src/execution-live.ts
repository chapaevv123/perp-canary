import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, orderBookEventsAbi, perpPoolEventsAbi, marginBankEventsAbi, perpPoolWriteAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, decodeEventLog, decodeFunctionData, formatUnits, http, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { normalize } from './evidence.ts';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC, PreflightError, isTimeout, readRpcHead } from './rpc-health.ts';
import type { ExecutionPlan, Operation, ReceiptObservation } from './execution.ts';

const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const WSS = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
const ORDER_GAS_LIMIT = 10_000_000n;
const ERC20_BALANCE = [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^\d{1,39}$/;
type PlanInput = { operation: Operation; account: string; pool: string; isBid?: boolean;
  price?: string; quantity?: string; orderId?: string };

function sdkWithSignal(controller: AbortController): SomniaMarkets {
  return new SomniaMarkets({ chain: hidekiTestnet, wsRpcUrl: WSS, indexerUrl: INDEXER,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
}

function positiveUnits(value: string | undefined, decimals: number, label: string): bigint {
  if (!value || !/^\d{1,24}(?:\.\d{1,24})?$/.test(value)) throw new Error(`Invalid ${label}; use a positive decimal amount`);
  const raw = parseUnits(value, decimals);
  if (raw <= 0n) throw new Error(`${label} must be positive`);
  return raw;
}

export async function collectPlan(input: PlanInput): Promise<ExecutionPlan> {
  if (!['PLACE', 'CANCEL', 'CLOSE'].includes(input.operation)) throw new Error('Unsupported operation');
  if (!isAddress(input.account) || !isAddress(input.pool)) throw new Error('Account and pool must be EVM addresses');
  if (input.operation === 'PLACE' && typeof input.isBid !== 'boolean') throw new Error('Side is required');
  if (input.operation === 'CANCEL' && (!input.orderId || !UINT.test(input.orderId)))
    throw new Error('A decimal orderId is required for cancel');
  if (input.operation !== 'CANCEL') {
    if (!input.price || !/^\d{1,24}(?:\.\d{1,24})?$/.test(input.price)) throw new Error('Invalid price; use a positive decimal amount');
    if (/^0+(?:\.0+)?$/.test(input.price)) throw new Error('Price must be positive');
    if ((input.operation === 'PLACE' || input.quantity) &&
      (!input.quantity || !/^\d{1,24}(?:\.\d{1,24})?$/.test(input.quantity)))
      throw new Error('Invalid quantity; use a positive decimal amount');
    if (input.quantity && /^0+(?:\.0+)?$/.test(input.quantity)) throw new Error('Quantity must be positive');
  }
  const { blockNumber } = await readRpcHead();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await collectPlanSdk(input, blockNumber); }
    catch (error) {
      if (isTimeout(error) || (error instanceof PreflightError && error.code === 'RPC_TIMEOUT')) {
        if (attempt === 1) continue;
        throw new PreflightError('RPC_TIMEOUT', error instanceof PreflightError ? error.phase : 'SDK preflight', 'WSS', attempt);
      }
      throw error;
    }
  }
  throw new PreflightError('RPC_READ_FAILED', 'SDK market/account preflight', 'WSS', 2);
}

async function collectPlanSdk(input: PlanInput, blockNumber: string): Promise<ExecutionPlan> {
  const controller = new AbortController();
  const sdk = sdkWithSignal(controller);
  let phase = 'checking SDK WSS chain';
  try { return await withSnapshotSdk(sdk, controller, async () => {
    const sdkChainId = await sdk.client.getViemClient().getChainId();
    if (sdkChainId !== 50383) throw new Error(`Wrong SDK WSS chain ID ${sdkChainId}`);
    phase = 'loading perp market';
    const market = (await sdk.client.listPerpMarkets()).find(row => row.poolAddress.toLowerCase() === input.pool.toLowerCase());
    if (!market) throw new Error('Pool is absent from current perp market rows');
    phase = 'reading system, pool, feed, and position';
    const system = await sdk.client.getPerpSystemConfig(market.marginBank);
    const status = (await sdk.client.listPerpPoolStatuses({ factory: system.perpPoolFactory }))
      .find(row => row.pool.toLowerCase() === market.poolAddress.toLowerCase());
    const feed = await sdk.client.getPerpFeedStatus(market.poolAddress);
    const position = await sdk.client.getPerpPosition({ marginBank: market.marginBank,
      account: input.account as Address, pool: market.poolAddress });
    phase = 'reading wallet gas, collateral and MarginBank state';
    const [gasWei, walletCollateral, margin, voucherEligibility] = await Promise.all([
      sdk.client.getViemClient().getBalance({ address: input.account as Address }),
      sdk.client.getViemClient().readContract({ address: system.collateralToken, abi: ERC20_BALANCE,
        functionName: 'balanceOf', args: [input.account as Address] }),
      sdk.client.getMarginAccount(market.marginBank, input.account as Address),
      sdk.client.getPerpVoucherEligibility(market.marginBank, input.account as Address)
        .catch(error => ({ status: 'NOT_AVAILABLE', reason: error instanceof Error ? error.name : 'READ_FAILED' })),
    ]);
    const blockers: string[] = [];
    const warnings: string[] = ['Market, feed, position, and RPC block were read sequentially, not atomically'];
    if (gasWei === 0n) blockers.push('Wallet has no STT for transaction gas');
    if (!system.fullyWired) blockers.push('Perp system is not fully wired');
    if (market.quoteToken.toLowerCase() !== system.collateralToken.toLowerCase()) blockers.push('Market collateral differs from MarginBank collateral');
    if (input.operation === 'PLACE' && margin.marginStatus !== 'Healthy') blockers.push(`Margin account is ${margin.marginStatus}`);
    warnings.push('Contest whitelist status cannot be verified through this SDK; trading restrictions are checked separately');
    if (!status?.registered) blockers.push('Pool is not registered by the factory');
    if (input.operation === 'PLACE' && !status?.tradeable) blockers.push('Pool is not tradeable at observation time');
    if (input.operation !== 'CANCEL' && (!feed.markPriceOk || feed.markPrice === 0n)) blockers.push('Mark feed is unavailable');
    const lot = BigInt(market.lotSize);
    const tick = BigInt(market.tickSize);
    if (lot <= 0n || tick <= 0n) throw new Error('Market tick or lot size is invalid');
    const minimumTestQuantity = (BigInt(market.minQuantity) + lot - 1n) / lot * lot;
    let isBid: boolean | null = null;
    let price: bigint | null = null;
    let quantity: bigint | null = null;
    let orderId: string | null = null;
    let preview: Record<string, unknown> | null = null;
    let unsigned: ExecutionPlan['unsigned'];
    let estimatedGas: bigint | null = null;
    let estimatedGasCostWei: bigint | null = null;
    if (input.operation === 'CANCEL') {
      if (!input.orderId || !UINT.test(input.orderId)) throw new Error('A decimal orderId is required for cancel');
      orderId = input.orderId;
      phase = 'reading resting order';
      const order = await sdk.client.getOrderOnchain(market.poolAddress, BigInt(orderId));
      if (!order) blockers.push('Resting order was not found on chain');
      else {
        if (order.owner.toLowerCase() !== input.account.toLowerCase()) blockers.push('Order owner differs from account');
        if (order.quantityRemaining === 0n) blockers.push('Order has no remaining quantity');
        preview = normalize(order) as Record<string, unknown>;
      }
    } else {
      isBid = input.operation === 'CLOSE' ? position.size < 0n : input.isBid === true;
      if (input.operation === 'PLACE' && typeof input.isBid !== 'boolean') throw new Error('Side is required');
      price = positiveUnits(input.price, market.quoteDecimals, 'price');
      quantity = input.operation === 'CLOSE' && !input.quantity
        ? (position.size < 0n ? -position.size : position.size) / lot * lot
        : positiveUnits(input.quantity, market.baseDecimals, 'quantity');
      if (input.operation === 'CLOSE' && position.size === 0n) blockers.push('No position exists to close');
      if (input.operation === 'CLOSE') warnings.push('The SDK limit order has no reduce-only guarantee; recheck position immediately before manual signing');
      if (quantity <= 0n || quantity % lot !== 0n) blockers.push('Quantity does not meet the lot grid');
      if (quantity < BigInt(market.minQuantity)) blockers.push('Quantity is below the pool minimum');
      if (input.operation === 'PLACE' && quantity > minimumTestQuantity) {
        blockers.push(`M2 IOC wallet order is capped at ${formatUnits(minimumTestQuantity, market.baseDecimals)} base units`);
      }
      if (price % tick !== 0n) blockers.push('Price does not meet the tick grid');
      if (input.operation === 'CLOSE' && quantity > (position.size < 0n ? -position.size : position.size)) {
        blockers.push('Close quantity exceeds current position size');
      }
      if (quantity > 0n && quantity % lot === 0n && quantity >= BigInt(market.minQuantity) && price % tick === 0n) {
        phase = 'previewing margin and maximum size';
        const [margin, maximum] = await Promise.all([
          sdk.client.previewPerpOrderMargin({ pool: market.poolAddress, marginBank: market.marginBank,
            account: input.account as Address, isBid, price, quantity }),
          sdk.client.getMaxPerpOrderSize({ pool: market.poolAddress, marginBank: market.marginBank,
            account: input.account as Address, isBid, price }),
        ]);
        if (!margin.priceable || !maximum.priceable) blockers.push('SDK could not price the order');
        if (margin.priceable && !margin.sufficient) blockers.push('SDK margin preview rejects this order');
        if (maximum.priceable && (!maximum.placeable || quantity > maximum.maxQuantity)) blockers.push('Quantity exceeds SDK placeable maximum');
        preview = { margin: normalize(margin), maximum: normalize(maximum) };
      } else warnings.push('SDK preview skipped until quantity and price match the market grid');
    }
    if (input.operation === 'PLACE' && blockers.length === 0 && isBid !== null && price !== null && quantity !== null) {
      phase = 'building unsigned perp order with Markets SDK';
      const walletClient = createWalletClient({ account: input.account as Address, chain: hidekiTestnet,
        transport: http(RPC) });
      const trader = sdk.client.createTrader({ walletClient });
      const built = await trader.buildPlacePerpOrder({ pool: market.poolAddress, isBid, price, quantity,
        orderType: 2 });
      if (built.approval || built.order.chainId !== 50383 || built.order.to.toLowerCase() !== market.poolAddress.toLowerCase()
        || built.order.value !== 0n) throw new Error('SDK unsigned perp call failed safety checks');
      unsigned = { chainId: 50383, to: built.order.to, data: built.order.data,
        value: built.order.value.toString(), description: built.order.description };
      phase = 'simulating gas for the unsigned order';
      try {
        const [gas, gasPrice] = await Promise.all([
          sdk.client.getViemClient().estimateGas({ account: input.account as Address,
            to: built.order.to, data: built.order.data, value: 0n }),
          sdk.client.getViemClient().getGasPrice(),
        ]);
        estimatedGas = gas;
        estimatedGasCostWei = ORDER_GAS_LIMIT * gasPrice;
        if (gas > ORDER_GAS_LIMIT) blockers.push('Estimated order gas exceeds the 10M gas safety limit');
        if (gasWei < estimatedGasCostWei) blockers.push('Wallet STT is below the estimated transaction gas cost');
      } catch (error) {
        if (isTimeout(error)) throw error;
        blockers.push('RPC gas simulation failed; order cannot be offered to the wallet');
        warnings.push(`Gas simulation error: ${error instanceof Error ? error.name : 'UNKNOWN'}`);
      }
      if (blockers.length) unsigned = undefined;
    }
    return { schema: 'perp-canary/plan/v1', tier: 'LIVE', observedAt: new Date().toISOString(), chainId: 50383,
      operation: input.operation, account: input.account, pool: market.poolAddress, marginBank: market.marginBank,
      symbol: `${market.baseSymbol ?? 'UNKNOWN'}-PERP`,
      baseline: { blockNumber, positionSize: position.size.toString(), feedGate: feed.markPriceOk ? 'GREEN' : 'RED',
        markPrice: feed.markPrice?.toString() ?? null, consistency: 'SEQUENTIAL_READS_NOT_PINNED' },
      request: { isBid, price: price?.toString() ?? null, quantity: quantity?.toString() ?? null, orderId,
        orderType: input.operation === 'PLACE' ? 2 : null },
      preview, wallet: { gasWei: gasWei.toString(), gasSTT: formatUnits(gasWei, 18), collateralToken: system.collateralToken,
        walletCollateral: walletCollateral.toString(), walletCollateralHuman: formatUnits(walletCollateral, market.quoteDecimals),
        unlockedMarginHuman: formatUnits(margin.unlockedCollateralBalance, market.quoteDecimals),
        margin: normalize(margin) as Record<string, unknown>,
        voucherEligibility: normalize(voucherEligibility), whitelist: 'NOT_VERIFIED',
        estimatedGas: estimatedGas?.toString() ?? null, gasLimit: estimatedGas === null ? null : ORDER_GAS_LIMIT.toString(),
        estimatedGasCostWei: estimatedGasCostWei?.toString() ?? null },
      unsigned, blockers, warnings, method: input.operation === 'CANCEL' ? 'cancelOrder' : 'placePerpOrder', sendEnabled: false };
  }, () => phase); }
  catch (error) {
    if (isTimeout(error)) throw new PreflightError('RPC_TIMEOUT', phase, 'WSS', 1);
    if (error instanceof Error && /Rpc|WebSocket|HttpRequest/i.test(error.name))
      throw new PreflightError('RPC_READ_FAILED', phase, 'WSS', 1);
    throw error;
  }
}

export async function observeReceipt(plan: ExecutionPlan, txHash: string): Promise<ReceiptObservation> {
  if (!HASH.test(txHash)) throw new Error('Transaction hash must be 0x plus 64 hex characters');
  const controller = new AbortController();
  const sdk = sdkWithSignal(controller);
  let phase = 'reading transaction receipt';
  return withSnapshotSdk(sdk, controller, async () => {
    const client = sdk.client.getViemClient();
    const chainId = await client.getChainId();
    if (chainId !== 50383) throw new Error(`Wrong chain ID ${chainId}`);
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
    phase = 'reading transaction sender and target';
    const tx = await client.getTransaction({ hash: txHash as Hex });
    let call: ReceiptObservation['call'] = null;
    try {
      const decoded = decodeFunctionData({ abi: perpPoolWriteAbi, data: tx.input });
      if (decoded.functionName === 'placeOrder') {
        call = { method: 'placeOrder', isBid: decoded.args[0], price: decoded.args[2].toString(),
          quantity: decoded.args[3].toString(), orderType: decoded.args[5] };
      } else if (decoded.functionName === 'cancelOrder') {
        call = { method: 'cancelOrder', orderId: decoded.args[0].toString() };
      }
    } catch { /* unknown calldata is reported as AMBER */ }
    const placedOrderIds: string[] = [];
    let foreignOrderEvents = 0;
    const cancelledOrderIds: string[] = [];
    const fills: ReceiptObservation['fills'] = [];
    const positionEvents: ReceiptObservation['positionEvents'] = [];
    let unknownLogs = 0;
    for (const log of receipt.logs) {
      const atPool = log.address.toLowerCase() === plan.pool.toLowerCase();
      const atBank = log.address.toLowerCase() === plan.marginBank.toLowerCase();
      if (!atPool && !atBank) continue;
      try {
        const decoded = decodeEventLog({ abi: atPool ? [...orderBookEventsAbi, ...perpPoolEventsAbi] : marginBankEventsAbi,
          topics: log.topics, data: log.data });
        const args = normalize(decoded.args) as Record<string, unknown>;
        if (atPool && decoded.eventName === 'OrderPlaced') {
          const placed = args.placedOrder as { owner?: string } | undefined;
          if (placed?.owner?.toLowerCase() === plan.account.toLowerCase()) placedOrderIds.push(String(args.orderId));
          else foreignOrderEvents++;
        }
        if (atPool && decoded.eventName === 'OrderCancelled') cancelledOrderIds.push(String(args.orderId));
        if (atPool && decoded.eventName === 'OrderFilled') fills.push({ quantity: String(args.quantityFilled),
          price: String(args.fillPrice), takerOrderId: String(args.takerOrderId) });
        if (atBank && decoded.eventName === 'PositionUpdated') positionEvents.push({
          account: String(args.account), pool: String(args.perpPool), newSize: String(args.newSize) });
      } catch { unknownLogs++; }
    }
    phase = 'reading current post-transaction position';
    let postPositionSize: string | null = null;
    try {
      const post = await sdk.client.getPerpPosition({ marginBank: plan.marginBank as Address,
        account: plan.account as Address, pool: plan.pool as Address });
      postPositionSize = post.size.toString();
    } catch { /* receipt remains usable; current position is unknown */ }
    return { tier: 'LIVE', txHash, chainId, status: receipt.status, from: tx.from, to: tx.to, call,
      blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null, placedOrderIds,
      foreignOrderEvents, cancelledOrderIds, fills, positionEvents, postPositionSize, unknownLogs };
  }, () => phase);
}
