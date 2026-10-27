import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, orderBookEventsAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, decodeEventLog, encodeFunctionData, formatUnits, getAddress, http,
  isAddress, parseAbi, parseUnits, toFunctionSelector, type Address, type Hex } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC, readRpcHead } from './rpc-health.ts';
import { BTC_POOL, HIDEKI_MARGIN_BANK } from './trade-forensics.ts';
import { readTerminalMarket } from './terminal-data.ts';

export const DIRECT_PLACE_ABI = parseAbi([
  'function placeOrder(bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) returns (bool success,uint128 orderId)',
]);
export const DIRECT_CANCEL_ABI = parseAbi(['function cancelOrder(uint128 orderId)']);
if (toFunctionSelector(DIRECT_PLACE_ABI[0]!) !== '0x4e978373' ||
  toFunctionSelector(DIRECT_CANCEL_ABI[0]!) !== '0xdbc91396') throw Error('Direct pool selectors differ from installed SDK');
const ZERO = '0x0000000000000000000000000000000000000000';
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const poolAbi = parseAbi(['function marginBank() view returns (address)']);
const limit = 100n * 10n ** 18n;
const gasBudget = 10n ** 17n;

export type DirectInput = { account: string; side: 'BUY' | 'SELL'; price: string; quantity: string;
  orderType: 'POST_ONLY'; expiresAt?: number };
export type TradeObservation = {
  chainId: number; observedAt: string; block: string; pool: string; marginBank: string;
  book: { status: string; observedAt: string | null; bid: string | null; ask: string | null };
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
  if (o.chainId !== 50383 || o.pool.toLowerCase() !== BTC_POOL.toLowerCase() ||
    o.marginBank.toLowerCase() !== HIDEKI_MARGIN_BANK.toLowerCase()) blockers.push('Wrong network or unverified BTC-PERP contracts.');
  if (input.orderType !== 'POST_ONLY' || !['BUY', 'SELL'].includes(input.side)) blockers.push('Unsupported side or order type.');
  const age = now - Date.parse(o.book.observedAt ?? '');
  const observationAge = now - Date.parse(o.observedAt);
  if (o.book.status !== 'TRUSTED' || !Number.isFinite(age) || age < 0 || age > 30_000 ||
    !Number.isFinite(observationAge) || observationAge < 0 || observationAge > 30_000)
    blockers.push('Trusted market snapshot is unavailable or stale.');
  if (o.grid.baseDecimals !== 8 || o.grid.quoteDecimals !== 18) blockers.push('BTC-PERP token decimals are unverified.');
  try {
    if (!/^\d+(?:\.\d+)?$/.test(input.price) || !/^\d+(?:\.\d+)?$/.test(input.quantity)) throw Error();
    price = parseUnits(input.price, 18); quantity = parseUnits(input.quantity, 8);
    if (price <= 0n || quantity <= 0n) throw Error();
    notional = price * quantity / 10n ** 8n;
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
export async function readDirectAccount(rawAccount: string) {
  const account = address(rawAccount);
  const head = await readRpcHead();
  if (head.chainId !== 50383) throw Error('Hideki RPC chain mismatch');
  return withSdk(async sdk => {
    const market = (await sdk.client.listPerpMarkets()).find(row => row.poolAddress.toLowerCase() === BTC_POOL.toLowerCase());
    if (!market || market.marginBank.toLowerCase() !== HIDEKI_MARGIN_BANK.toLowerCase() ||
      market.baseDecimals !== 8 || market.quoteDecimals !== 18) throw Error('BTC-PERP market registry mismatch');
    const system = await sdk.client.getPerpSystemConfig(market.marginBank);
    const [bank, gas, walletUsdso, margin, position, open] = await Promise.all([
      client.readContract({ address: BTC_POOL, abi: poolAbi, functionName: 'marginBank' }),
      client.getBalance({ address: account }),
      client.readContract({ address: system.collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
      sdk.client.getMarginAccount(market.marginBank, account),
      sdk.client.getPerpPosition({ marginBank: market.marginBank, pool: market.poolAddress, account }),
      sdk.client.getOpenOrdersOnchain([market.poolAddress], account, { blockNumber: BigInt(head.blockNumber) }),
    ]);
    if (bank.toLowerCase() !== HIDEKI_MARGIN_BANK.toLowerCase()) throw Error('Pool MarginBank mismatch');
    return { account, chainId: head.chainId, block: head.blockNumber, observedAt: new Date().toISOString(),
      pool: market.poolAddress, marginBank: market.marginBank, gasStt: formatUnits(gas, 18), gasWei: gas.toString(),
      walletUsdso: formatUnits(walletUsdso, 18), walletUsdsoRaw: walletUsdso.toString(),
      marginUnlocked: formatUnits(margin.unlockedCollateralBalance, 18),
      marginUnlockedRaw: margin.unlockedCollateralBalance.toString(),
      position: { sizeBtc: formatUnits(position.size, 8), entryPrice: formatUnits(position.avgEntryPrice, 18) },
      openOrders: open.orders.map(row => ({ id: row.orderId.toString(), side: row.isBid ? 'BUY' : 'SELL',
        price: formatUnits(row.price, 18), remaining: formatUnits(row.quantityRemaining, 8) })) };
  });
}

export async function prepareDirectTrade(input: DirectInput) {
  const account = address(input.account);
  const [market, user] = await Promise.all([readTerminalMarket(), readDirectAccount(account)]);
  if (!/^\d+(?:\.\d+)?$/.test(input.price)) throw Error('Invalid limit price');
  const price = parseUnits(input.price, 18);
  const max = await withSdk(async sdk => sdk.client.getMaxPerpOrderSize({
    pool: BTC_POOL, marginBank: HIDEKI_MARGIN_BANK, account, isBid: input.side === 'BUY', price }));
  const observation: TradeObservation = { chainId: market.chainId, observedAt: market.observedAt,
    block: market.block, pool: user.pool, marginBank: user.marginBank,
    book: market.book, mark: market.mark, grid: market.grid, account: {
      address: user.account, gasWei: user.gasWei, walletUsdsoRaw: user.walletUsdsoRaw,
      marginUnlockedRaw: user.marginUnlockedRaw, maxQuantityRaw: max.priceable ? max.maxQuantity.toString() : null,
      maxPriceable: max.priceable, maxPlaceable: max.priceable && max.placeable,
      limitedBy: max.priceable ? max.limitedBy : 'STALE_MARK',
    } };
  const guard = assessDirectTrade(input, observation);
  if (guard.verdict === 'RED' || !guard.priceRaw || !guard.quantityRaw)
    return { status: 'BLOCKED' as const, guard, observation, transaction: null };
  const now = Date.now();
  const expiresAt = input.expiresAt ?? now + 300_000;
  if (!Number.isInteger(expiresAt) || expiresAt < now + 30_000 || expiresAt > now + 300_000)
    throw Error('Order expiry must remain within the 300-second safety window');
  const data = encodeFunctionData({ abi: DIRECT_PLACE_ABI, functionName: 'placeOrder',
    args: [input.side === 'BUY', 0n, BigInt(guard.priceRaw), BigInt(guard.quantityRaw),
      BigInt(expiresAt) * 1_000_000n, 3, 0, ZERO, 0n] });
  let gas: bigint;
  try { gas = await client.estimateGas({ account, to: BTC_POOL, data, value: 0n }); }
  catch (error) { return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers,
      `Contract simulation failed: ${error instanceof Error ? error.message : 'UNKNOWN'}`] }, observation, transaction: null }; }
  const gasPrice = await client.getGasPrice();
  const gasLimit = gas * 12n / 10n;
  const maxCost = gasLimit * gasPrice;
  if (maxCost > gasBudget || maxCost > BigInt(user.gasWei)) return { status: 'BLOCKED' as const,
    guard: { ...guard, verdict: 'RED' as const, blockers: [...guard.blockers, 'Simulated gas exceeds wallet balance or 0.1 STT budget.'] },
    observation, transaction: null };
  return { status: 'READY' as const, guard, observation,
    transaction: { chainId: 50383, from: account, to: BTC_POOL, data, value: '0x0',
      gas: `0x${gasLimit.toString(16)}`, expiresAt: new Date(expiresAt).toISOString(),
      estimatedGas: gas.toString(), maxGasCostStt: formatUnits(maxCost, 18) } };
}

export async function readDirectReceipt(hash: string, rawAccount: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
  const account = address(rawAccount);
  const notFound = (error: unknown) => {
    if (error instanceof Error && /Transaction(NotFound|ReceiptNotFound)Error/.test(error.name)) return null;
    throw error;
  };
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: hash as Hex }).catch(notFound),
    client.getTransactionReceipt({ hash: hash as Hex }).catch(notFound),
  ]);
  if (!tx) return { state: 'PENDING' as const, hash };
  if (tx.from.toLowerCase() !== account.toLowerCase() || tx.to?.toLowerCase() !== BTC_POOL.toLowerCase() ||
    !tx.input.startsWith('0x4e978373')) throw Error('Transaction is not this wallet’s direct BTC-PERP placeOrder');
  if (!receipt) return { state: 'PENDING' as const, hash };
  if (receipt.status !== 'success') return { state: 'FAILED' as const, hash, block: receipt.blockNumber.toString() };
  const placed = receipt.logs.filter(log => log.address.toLowerCase() === BTC_POOL.toLowerCase()).flatMap(log => {
    try { const event = decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics });
      return event.eventName === 'OrderPlaced' ? [event] : []; }
    catch { return []; }
  }).find(event => String((event.args as { placedOrder?: { owner?: string } }).placedOrder?.owner).toLowerCase() === account.toLowerCase());
  if (!placed) return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
    reason: 'Successful receipt lacks a matching OrderPlaced event.' };
  return { state: 'PLACED' as const, hash, block: receipt.blockNumber.toString(),
    orderId: String((placed.args as { orderId?: bigint }).orderId),
    note: 'Receipt confirms placement; current open or filled state requires a fresh account read.' };
}
