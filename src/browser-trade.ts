import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, orderBookEventsAbi,
  marginBankEventsAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, formatUnits, getAddress, http,
  isAddress, parseAbi, parseUnits, toFunctionSelector, type Address, type Hex } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC, readRpcHead } from './rpc-health.ts';
import { BTC_POOL, HIDEKI_MARGIN_BANK } from './trade-forensics.ts';
import { readVerifiedMarket, verifiedMarket } from './market-registry.ts';

export const DIRECT_PLACE_ABI = parseAbi([
  'function placeOrder(bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) returns (bool success,uint128 orderId)',
]);
export const DIRECT_CANCEL_ABI = parseAbi(['function cancelOrder(uint128 orderId)']);
if (toFunctionSelector(DIRECT_PLACE_ABI[0]!) !== '0x4e978373' ||
  toFunctionSelector(DIRECT_CANCEL_ABI[0]!) !== '0xdbc91396') throw Error('Direct pool selectors differ from installed SDK');
const ZERO = '0x0000000000000000000000000000000000000000';
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const poolAbi = parseAbi(['function marginBank() view returns (address)']);
const bankWriteAbi = parseAbi(['function deposit(uint256)', 'function withdraw(uint256)']);
const limit = 100n * 10n ** 18n;
const gasBudget = 10n ** 17n;
const COLLATERAL = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72';

export type DirectInput = { account: string; market?: string; side: 'BUY' | 'SELL'; price: string; quantity: string;
  orderType: 'POST_ONLY'; expiresAt?: number };
export type TradeObservation = {
  chainId: number; observedAt: string; block: string; pool: string; marginBank: string;
  expectedPool?: string;
  book: { status: string; observedAt: string | null; bid: string | null; ask: string | null };
  depth?: { status: string; bids: Array<{ quantity: string }>; asks: Array<{ quantity: string }> };
  mark: string | null; grid: { tickSizeRaw: string; lotSizeRaw: string; minQuantityRaw: string;
    baseDecimals: number | null; quoteDecimals: number | null };
  account: { address: string; gasWei: string; walletUsdsoRaw: string; marginUnlockedRaw: string;
    maxQuantityRaw: string | null; maxPriceable: boolean; maxPlaceable: boolean;
    limitedBy: string | null };
};
export type GuardResult = { verdict: 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'; blockers: string[];
  warnings: string[]; priceRaw: string | null; quantityRaw: string | null; notionalRaw: string | null };

export function assessDirectTrade(input: DirectInput, o: TradeObservation, now = Date.now()): GuardResult {
  const blockers: string[] = [], warnings: string[] = [];
  let price: bigint | null = null, quantity: bigint | null = null, notional: bigint | null = null;
  if (!isAddress(input.account, { strict: false }) ||
    input.account.toLowerCase() !== o.account.address.toLowerCase()) blockers.push('Connected wallet differs from preflight account.');
  if (o.chainId !== 50383 || o.pool.toLowerCase() !== (o.expectedPool ?? BTC_POOL).toLowerCase() ||
    o.marginBank.toLowerCase() !== HIDEKI_MARGIN_BANK.toLowerCase()) blockers.push('Wrong network or unverified BTC-PERP contracts.');
  if (input.orderType !== 'POST_ONLY' || !['BUY', 'SELL'].includes(input.side)) blockers.push('Unsupported side or order type.');
  const age = now - Date.parse(o.book.observedAt ?? '');
  const observationAge = now - Date.parse(o.observedAt);
  if (o.book.status !== 'TRUSTED' || !Number.isFinite(age) || age < 0 || age > 30_000 ||
    !Number.isFinite(observationAge) || observationAge < 0 || observationAge > 30_000)
    blockers.push('Trusted market snapshot is unavailable or stale.');
  if (o.grid.baseDecimals === null || o.grid.baseDecimals < 1 || o.grid.baseDecimals > 36 ||
    o.grid.quoteDecimals !== 18) blockers.push('Market token decimals are unverified.');
  try {
    if (!/^\d+(?:\.\d+)?$/.test(input.price) || !/^\d+(?:\.\d+)?$/.test(input.quantity)) throw Error();
    price = parseUnits(input.price, o.grid.quoteDecimals ?? 18);
    quantity = parseUnits(input.quantity, o.grid.baseDecimals ?? 8);
    if (price <= 0n || quantity <= 0n) throw Error();
    notional = price * quantity / 10n ** BigInt(o.grid.baseDecimals ?? 8);
    const tick = BigInt(o.grid.tickSizeRaw), lot = BigInt(o.grid.lotSizeRaw), min = BigInt(o.grid.minQuantityRaw);
    if (tick <= 0n || lot <= 0n || min <= 0n || price % tick !== 0n || quantity < min || quantity % lot !== 0n)
      blockers.push('Price or quantity is off the verified tick/lot grid.');
    if (notional <= 0n || notional > limit) blockers.push('Order exceeds the 100 USDso safety limit.');
    const mark = parseUnits(o.mark ?? '', 18);
    if (mark <= 0n || (price > mark ? price - mark : mark - price) * 100n > mark)
      blockers.push('Limit price differs from mark by more than 1%.');
    const opposite = parseUnits((input.side === 'BUY' ? o.book.ask : o.book.bid) ?? '', 18);
    if (opposite <= 0n || (input.side === 'BUY' ? price >= opposite : price <= opposite))
      blockers.push('PostOnly limit would cross the opposite book top.');
    const bid = parseUnits(o.book.bid ?? '', 18), ask = parseUnits(o.book.ask ?? '', 18);
    if (bid > 0n && ask > bid && (ask - bid) * 10_000n > ((ask + bid) / 2n) * 20n)
      warnings.push('Bid/ask spread exceeds the 20 bps Canary watch threshold.');
    if (o.depth?.status === 'VERIFIED') {
      const visible = (input.side === 'BUY' ? o.depth.asks : o.depth.bids).reduce((sum, row) =>
        sum + parseUnits(row.quantity, o.grid.baseDecimals ?? 8), 0n);
      if (visible < quantity) warnings.push('Visible top-five opposing depth is smaller than this order; future fill is uncertain.');
    } else warnings.push('Deeper book liquidity is unavailable; execution impact cannot be estimated.');
  } catch { blockers.push('Enter a positive price and quantity with BTC/USDso decimals.'); }
  if (!o.account.maxPriceable || !o.account.maxPlaceable || o.account.maxQuantityRaw === null)
    blockers.push(`Margin size unavailable or blocked${o.account.limitedBy ? `: ${o.account.limitedBy}` : ''}.`);
  else if (quantity !== null && quantity > BigInt(o.account.maxQuantityRaw))
    blockers.push(`Quantity exceeds account placeable size (${o.account.limitedBy ?? 'margin'}).`);
  if (BigInt(o.account.gasWei) <= 0n) blockers.push('Wallet has no STT for gas.');
  if (BigInt(o.account.marginUnlockedRaw) <= 0n && quantity !== null && quantity > 0n)
    warnings.push('No unlocked MarginBank collateral; a reducing order may still be possible.');
  if (input.side === 'SELL') warnings.push('SELL can add a short; this is not a reduce-only order.');
  return { verdict: blockers.length ? 'RED' : warnings.length ? 'AMBER' : 'GREEN', blockers, warnings,
    priceRaw: price?.toString() ?? null, quantityRaw: quantity?.toString() ?? null,
    notionalRaw: notional?.toString() ?? null };
}

const address = (value: string): Address => {
  if (!isAddress(value, { strict: false })) throw Error('A valid connected EVM account is required');
  return getAddress(value);
};
async function withSdk<T>(work: (sdk: SomniaMarkets) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, () => work(sdk), () => 'reading user trading account', 45_000);
}
export async function readDirectAccount(rawAccount: string, marketId = BTC_POOL) {
  const account = address(rawAccount);
  const selected = await verifiedMarket(marketId);
  const head = await readRpcHead();
  if (head.chainId !== 50383) throw Error('Hideki RPC chain mismatch');
  return withSdk(async sdk => {
    const system = await sdk.client.getPerpSystemConfig(selected.marginBank);
    const [bank, gas, walletUsdso, allowance, margin, position, open] = await Promise.all([
      client.readContract({ address: selected.pool, abi: poolAbi, functionName: 'marginBank' }),
      client.getBalance({ address: account }),
      client.readContract({ address: system.collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
      client.readContract({ address: system.collateralToken, abi: erc20Abi, functionName: 'allowance',
        args: [account, selected.marginBank] }),
      sdk.client.getMarginAccount(selected.marginBank, account),
      sdk.client.getPerpPosition({ marginBank: selected.marginBank, pool: selected.pool, account }),
      sdk.client.getOpenOrdersOnchain([selected.pool], account, { blockNumber: BigInt(head.blockNumber) }),
    ]);
    if (bank.toLowerCase() !== HIDEKI_MARGIN_BANK.toLowerCase()) throw Error('Pool MarginBank mismatch');
    return { account, chainId: head.chainId, block: head.blockNumber, observedAt: new Date().toISOString(),
      market: selected.symbol, marketId: selected.id, pool: selected.pool, marginBank: selected.marginBank,
      collateral: system.collateralToken, baseDecimals: selected.baseDecimals,
      gasStt: formatUnits(gas, 18), gasWei: gas.toString(),
      walletUsdso: formatUnits(walletUsdso, 18), walletUsdsoRaw: walletUsdso.toString(),
      allowance: formatUnits(allowance, 18), allowanceRaw: allowance.toString(),
      marginUnlocked: formatUnits(margin.unlockedCollateralBalance, 18),
      marginUnlockedRaw: margin.unlockedCollateralBalance.toString(),
      withdrawable: formatUnits(margin.withdrawable, 18), withdrawableRaw: margin.withdrawable.toString(),
      position: { size: formatUnits(position.size, selected.baseDecimals),
        sizeBtc: formatUnits(position.size, selected.baseDecimals), entryPrice: formatUnits(position.avgEntryPrice, 18) },
      openOrders: open.orders.map(row => ({ id: row.orderId.toString(), side: row.isBid ? 'BUY' : 'SELL',
        price: formatUnits(row.price, 18), remaining: formatUnits(row.quantityRemaining, selected.baseDecimals) })) };
  });
}

export async function prepareDirectTrade(input: DirectInput) {
  const account = address(input.account);
  const marketId = input.market ?? BTC_POOL;
  const [market, user] = await Promise.all([readVerifiedMarket(marketId, true), readDirectAccount(account, marketId)]);
  if (!/^\d+(?:\.\d+)?$/.test(input.price)) throw Error('Invalid limit price');
  const price = parseUnits(input.price, market.market.quoteDecimals);
  const max = await withSdk(async sdk => sdk.client.getMaxPerpOrderSize({
    pool: market.market.pool, marginBank: market.market.marginBank,
    account, isBid: input.side === 'BUY', price }));
  const observation: TradeObservation = { chainId: market.chainId, observedAt: market.observedAt,
    block: market.block, pool: user.pool, expectedPool: market.market.pool, marginBank: user.marginBank,
    book: market.book, depth: market.depth, mark: market.mark, grid: market.grid, account: {
      address: user.account, gasWei: user.gasWei, walletUsdsoRaw: user.walletUsdsoRaw,
      marginUnlockedRaw: user.marginUnlockedRaw, maxQuantityRaw: max.priceable ? max.maxQuantity.toString() : null,
      maxPriceable: max.priceable, maxPlaceable: max.priceable && max.placeable,
      limitedBy: max.priceable ? max.limitedBy : 'STALE_MARK',
    } };
  const guard = assessDirectTrade(input, observation);
  if (guard.verdict === 'RED' || !guard.priceRaw || !guard.quantityRaw)
    return { status: 'BLOCKED' as const, guard, observation, transaction: null };
  const preview = await withSdk(async sdk => sdk.client.previewPerpOrderMargin({
    pool: market.market.pool, marginBank: market.market.marginBank, account,
    isBid: input.side === 'BUY', price: BigInt(guard.priceRaw!), quantity: BigInt(guard.quantityRaw!) }));
  const marginPreview = { status: preview.priceable ? 'OK' as const : 'UNPRICEABLE' as const,
    sufficient: preview.priceable && preview.sufficient,
    lockUsdso: preview.priceable ? formatUnits(preview.lockAmount, 18) : null,
    initialRequirementUsdso: preview.priceable ? formatUnits(preview.imRequirement, 18) : null,
    asOfBlock: preview.asOfBlock.toString() };
  if (!marginPreview.sufficient) return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
      'MarginBank preview cannot prove sufficient collateral for this order'] },
    observation, marginPreview, transaction: null };
  const now = Date.now();
  const expiresAt = input.expiresAt ?? now + 300_000;
  if (!Number.isInteger(expiresAt) || expiresAt < now + 30_000 || expiresAt > now + 300_000)
    throw Error('Order expiry must remain within the 300-second safety window');
  const data = encodeFunctionData({ abi: DIRECT_PLACE_ABI, functionName: 'placeOrder',
    args: [input.side === 'BUY', 0n, BigInt(guard.priceRaw), BigInt(guard.quantityRaw),
      BigInt(expiresAt) * 1_000_000n, 3, 0, ZERO, 0n] });
  let gas: bigint;
  try { gas = await client.estimateGas({ account, to: market.market.pool, data, value: 0n }); }
  catch (error) { return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
      `Contract simulation failed: ${error instanceof Error ? error.message : 'UNKNOWN'}`] }, observation,
    marginPreview, transaction: null }; }
  const [gasPrice, nonce] = await Promise.all([client.getGasPrice(),
    client.getTransactionCount({ address: account, blockTag: 'pending' })]);
  const gasLimit = gas * 12n / 10n;
  const maxCost = gasLimit * gasPrice;
  if (maxCost > gasBudget || maxCost > BigInt(user.gasWei)) return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers, 'Simulated gas exceeds wallet balance or 0.1 STT budget.'] },
    observation, marginPreview, transaction: null };
  return { status: 'READY' as const, guard, observation, marginPreview,
    transaction: { chainId: 50383, market: market.market.symbol, marketId,
      from: account, to: market.market.pool, data, value: '0x0',
      gas: `0x${gasLimit.toString(16)}`, nonce, expiresAt: new Date(expiresAt).toISOString(),
      estimatedGas: gas.toString(), maxGasCostStt: formatUnits(maxCost, 18) } };
}

export async function readDirectReceipt(hash: string, rawAccount: string, marketId = BTC_POOL) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
  const account = address(rawAccount);
  const market = await verifiedMarket(marketId);
  const notFound = (error: unknown) => {
    if (error instanceof Error && /Transaction(NotFound|ReceiptNotFound)Error/.test(error.name)) return null;
    throw error;
  };
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: hash as Hex }).catch(notFound),
    client.getTransactionReceipt({ hash: hash as Hex }).catch(notFound),
  ]);
  if (!tx) return { state: 'PENDING' as const, hash };
  if (tx.from.toLowerCase() !== account.toLowerCase() || tx.to?.toLowerCase() !== market.pool.toLowerCase() ||
    !tx.input.startsWith('0x4e978373')) throw Error('Transaction is not this wallet’s direct perp placeOrder');
  const call = decodeFunctionData({ abi: DIRECT_PLACE_ABI, data: tx.input });
  const [isBid, userData, price, quantity, expiry, orderType, selfMatch, builder, fee] = call.args;
  if (userData !== 0n || price <= 0n || quantity <= 0n || expiry <= 0n ||
    orderType !== 3 || selfMatch !== 0 || builder.toLowerCase() !== ZERO || fee !== 0n)
    throw Error('Transaction parameters differ from direct PostOnly review');
  if (!receipt) return { state: 'PENDING' as const, hash };
  if (receipt.status !== 'success') return { state: 'FAILED' as const, hash, block: receipt.blockNumber.toString() };
  const events = receipt.logs.filter(log => log.address.toLowerCase() === market.pool.toLowerCase()).flatMap(log => {
    try { const event = decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics });
      return [event]; }
    catch { return []; }
  });
  const placed = events.find(event => event.eventName === 'OrderPlaced' &&
    String((event.args as { placedOrder?: { owner?: string } }).placedOrder?.owner).toLowerCase() === account.toLowerCase());
  if (!placed) return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
    reason: 'Successful receipt lacks a matching OrderPlaced event.' };
  const placedOrder = (placed.args as { placedOrder?: { isBid?: boolean; price?: bigint;
    fullQuantity?: bigint; expireTimestampNs?: bigint } }).placedOrder;
  if (!placedOrder || placedOrder.isBid !== isBid || placedOrder.price !== price ||
    placedOrder.fullQuantity !== quantity || placedOrder.expireTimestampNs !== expiry)
    return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
      reason: 'OrderPlaced event differs from transaction calldata.' };
  const orderId = String((placed.args as { orderId?: bigint }).orderId);
  const rested = events.some(event => event.eventName === 'OrderRested' &&
    String((event.args as { orderId?: bigint }).orderId) === orderId);
  return { state: 'PLACED' as const, hash, block: receipt.blockNumber.toString(), orderId,
    outcomeAtPlacement: rested ? 'RESTED_AT_PLACEMENT' : 'UNKNOWN',
    note: 'Receipt confirms placement; current open or filled state requires a fresh account read.' };
}

export type WalletActionInput = { account: string; market: string;
  action: 'APPROVE' | 'DEPOSIT' | 'WITHDRAW' | 'CANCEL'; amount?: string; orderId?: string };
export async function prepareWalletAction(input: WalletActionInput) {
  const account = address(input.account);
  const market = await verifiedMarket(input.market, true);
  const user = await readDirectAccount(account, market.id);
  if (user.chainId !== 50383 || user.marketId.toLowerCase() !== market.id.toLowerCase() ||
    user.pool.toLowerCase() !== market.pool.toLowerCase() ||
    user.collateral.toLowerCase() !== COLLATERAL.toLowerCase()) throw Error('Wallet market or collateral mismatch');
  let to: Address, data: Hex, amountRaw: bigint | null = null;
  if (input.action === 'CANCEL') {
    if (!input.orderId || !/^\d+$/.test(input.orderId)) throw Error('Invalid order ID');
    const id = BigInt(input.orderId);
    if (id <= 0n || id >= 2n ** 128n || !user.openOrders.some(order => order.id === input.orderId))
      throw Error('Order is not currently open for this wallet and market');
    to = market.pool;
    data = encodeFunctionData({ abi: DIRECT_CANCEL_ABI, functionName: 'cancelOrder', args: [id] });
  } else {
    if (!input.amount || !/^\d+(?:\.\d+)?$/.test(input.amount)) throw Error('Enter a positive USDso amount');
    amountRaw = parseUnits(input.amount, 18);
    if (amountRaw <= 0n || amountRaw > limit) throw Error('Margin action limited to 0–100 USDso per review');
    if (input.action === 'APPROVE') {
      if (BigInt(user.allowanceRaw) >= amountRaw) throw Error('Existing allowance already covers this amount');
      to = user.collateral;
      data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [market.marginBank, amountRaw] });
    } else if (input.action === 'DEPOSIT') {
      if (BigInt(user.walletUsdsoRaw) < amountRaw) throw Error('Wallet USDso balance is insufficient');
      if (BigInt(user.allowanceRaw) < amountRaw) throw Error('Approve this exact USDso amount first');
      to = market.marginBank;
      data = encodeFunctionData({ abi: bankWriteAbi, functionName: 'deposit', args: [amountRaw] });
    } else if (input.action === 'WITHDRAW') {
      if (BigInt(user.withdrawableRaw) < amountRaw) throw Error('MarginBank withdrawable balance is insufficient');
      to = market.marginBank;
      data = encodeFunctionData({ abi: bankWriteAbi, functionName: 'withdraw', args: [amountRaw] });
    } else throw Error('Unsupported wallet action');
  }
  const gas = await client.estimateGas({ account, to, data, value: 0n });
  const gasLimit = gas * 12n / 10n;
  const [gasPrice, nonce] = await Promise.all([client.getGasPrice(),
    client.getTransactionCount({ address: account, blockTag: 'pending' })]);
  if (gasLimit * gasPrice > gasBudget || gasLimit * gasPrice > BigInt(user.gasWei))
    throw Error('Simulated gas exceeds wallet balance or 0.1 STT budget');
  return { status: 'READY' as const, action: input.action, market: market.symbol, marketId: market.id,
    amount: input.amount ?? null, amountRaw: amountRaw?.toString() ?? null, orderId: input.orderId ?? null,
    allowance: user.allowance, walletUsdso: user.walletUsdso, withdrawable: user.withdrawable,
    transaction: { chainId: 50383, from: account, to, data, value: '0x0', gas: `0x${gasLimit.toString(16)}`,
      nonce,
      maxGasCostStt: formatUnits(gasLimit * gasPrice, 18) } };
}
export async function readWalletActionReceipt(hash: string, rawAccount: string,
  marketId: string, action: WalletActionInput['action'], orderId?: string, amount?: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
  const account = address(rawAccount), market = await verifiedMarket(marketId);
  const to = action === 'APPROVE' ? COLLATERAL : action === 'CANCEL' ? market.pool : market.marginBank;
  const selectors = { APPROVE: '0x095ea7b3', DEPOSIT: '0xb6b55f25',
    WITHDRAW: '0x2e1a7d4d', CANCEL: '0xdbc91396' };
  const tx = await client.getTransaction({ hash: hash as Hex }).catch(error => {
    if (error instanceof Error && error.name === 'TransactionNotFoundError') return null;
    throw error;
  });
  if (!tx) return { state: 'PENDING' as const, hash };
  if (!tx.to || !isAddress(to, { strict: false }) || tx.from.toLowerCase() !== account.toLowerCase() ||
    tx.to.toLowerCase() !== to.toLowerCase() || !tx.input.startsWith(selectors[action]))
    throw Error('Transaction sender, contract or method mismatch');
  if (action === 'CANCEL') {
    const call = decodeFunctionData({ abi: DIRECT_CANCEL_ABI, data: tx.input });
    if (!orderId || String(call.args[0]) !== orderId) throw Error('Cancelled order ID differs from review');
  } else {
    if (!amount || !/^\d+(?:\.\d+)?$/.test(amount)) throw Error('Reviewed amount is required');
    const expected = parseUnits(amount, 18);
    const call = decodeFunctionData({ abi: action === 'APPROVE' ? erc20Abi : bankWriteAbi, data: tx.input });
    const actual = action === 'APPROVE' ? call.args[1] : call.args[0];
    if (actual === undefined || BigInt(actual) !== expected || action === 'APPROVE' &&
      String(call.args[0]).toLowerCase() !== market.marginBank.toLowerCase())
      throw Error('Transaction amount or spender differs from review');
  }
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex }).catch(error => {
    if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null;
    throw error;
  });
  if (!receipt) return { state: 'PENDING' as const, hash };
  if (receipt.status !== 'success') return { state: 'FAILED' as const, hash, block: receipt.blockNumber.toString() };
  if (action === 'APPROVE') return { state: 'CONFIRMED' as const, hash, block: receipt.blockNumber.toString(),
    note: 'ERC-20 approval receipt confirmed; re-read allowance before deposit.' };
  const abi = action === 'CANCEL' ? orderBookEventsAbi : marginBankEventsAbi;
  const expected = action === 'CANCEL' ? 'OrderCancelled' : action === 'DEPOSIT' ? 'Deposited' : 'Withdrawn';
  const matching = receipt.logs.filter(log => log.address.toLowerCase() === to.toLowerCase()).some(log => {
    try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (event.eventName !== expected) return false;
      if (action === 'CANCEL') return String((event.args as { orderId?: bigint }).orderId) === orderId;
      return String((event.args as { account?: string }).account).toLowerCase() === account.toLowerCase(); }
    catch { return false; }
  });
  return { state: matching ? 'CONFIRMED' as const : 'UNKNOWN' as const, hash,
    block: receipt.blockNumber.toString(), reason: matching ? null : `Matching ${expected} event not found` };
}
