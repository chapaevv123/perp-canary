import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, ORDER_TYPE } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, encodeFunctionData, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits, toFunctionSelector, type Address, type Hex } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC, readRpcHead } from './rpc-health.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { classifySimulationFailure, type SimulationFailure } from './preflight-failure.ts';
import { BOOK_SOURCE, validateMarketSnapshot, type MarketBookSnapshot } from './market-integrity.ts';
import { PLACE_PLAN_LIFETIME_MS } from './place-plan-config.ts';

export const HISTORICAL_SENDER = '0x71f64cd5e6e05b8401d21dc34a82c5209d1b20f0';
export const HIDEKI_PERMISSION_REGISTRY = '0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a';
export class AuthorizationReadError extends Error {
  constructor() { super('Hideki authorization reads are unavailable; permissions and balances remain UNKNOWN'); }
}
export class AuthorizationInputError extends Error {}
export const AUTH_SOURCES = {
  bot: 'https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot',
  perps: 'https://app.testnet.dreamdex.io/docs/developers/perps-testnet',
  functions: 'https://app.testnet.dreamdex.io/docs/developers/contracts/functions',
  sdk: 'https://prd.smk.somnia.host/docs/typescript/perps',
} as const;
const POOL_ABI = parseAbi([
  'function isOperatorAuthorized(address owner,address operator,bytes4 selector) view returns (bool)',
  'function getOperatorPermissionsRegistry() view returns (address)',
  'function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool success,uint128 orderId)',
]);
const REGISTRY_ABI = parseAbi([
  'function isGloballyApproved(address owner,address operator,bytes4 selector) view returns (bool)',
  'function isApprovedForPool(address pool,address owner,address operator,bytes4 selector) view returns (bool)',
]);
const OWNER_ABI = parseAbi(['function isOwner(address owner) view returns (bool)']);
const DIRECT_BOOK_ABI = parseAbi([
  'function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])',
]);
export const SELECTORS = { place: '0x80054449', cancel: '0xe37b444b', reduce: '0x364c2587' } as const;
if (toFunctionSelector(POOL_ABI[2]!) !== SELECTORS.place) throw Error('Official placeOrderFor selector mismatch');
const ZERO = '0x0000000000000000000000000000000000000000';

export type Check = { status: 'SUPPORTED' | 'BLOCKED' | 'UNKNOWN'; value: string; source: string };
const check = (value: boolean | null, source: string): Check => ({ status: value === null ? 'UNKNOWN' : value ? 'SUPPORTED' : 'BLOCKED',
  value: value === null ? 'UNKNOWN' : String(value), source });
const address = (value: string, label: string): Address => {
  if (!isAddress(value, { strict: false })) throw Error(`${label} must be a public EVM address`);
  return getAddress(value);
};
const positive = (value: string, decimals: number, label: string): bigint => {
  if (!/^\d{1,24}(?:\.\d{1,24})?$/.test(value)) throw new AuthorizationInputError(`Invalid ${label}`);
  let amount: bigint;
  try { amount = parseUnits(value, decimals); }
  catch { throw new AuthorizationInputError(`${label} has too many decimal places`); }
  if (amount <= 0n) throw new AuthorizationInputError(`${label} must be positive`);
  return amount;
};
export type AuthorizationInput = { eoa?: string; tradingWallet?: string; operator?: string; pool?: string;
  side?: 'BUY' | 'SELL'; price?: string; quantity?: string; executionMode?: 'IOC' | 'POST_ONLY' };
export type AuthorizationDecision = { status: 'BLOCKED' | 'UNKNOWN'; blockers: string[]; nextStep: string };
export type MarginPreviewDiagnostic = { status: 'NOT_RUN' | 'READ_ERROR' } |
  { status: 'UNPRICEABLE'; asOfBlock: string } |
  { status: 'OK'; asOfBlock: string; sufficient: boolean; hasCollateralForLock: boolean;
    meetsInitialMargin: boolean; voucherBlocked: boolean; restrictedBlocked: boolean;
    isolationBlocked: boolean; lockAmountRaw: string; unlockedCollateralRaw: string;
    equityRaw: string; imRequirementRaw: string; increasingQuantityRaw: string;
    reducingQuantityRaw: string };
export type MaxPlaceableDiagnostic = { status: 'NOT_RUN' | 'READ_ERROR' } |
  { status: 'UNPRICEABLE'; asOfBlock: string } |
  { status: 'OK'; asOfBlock: string; placeable: boolean; maxQuantityRaw: string;
    requestedQuantityRaw: string; limitedBy: string; positionSizeRaw: string;
    minQuantityRaw: string; lotSizeRaw: string };
export function decideAuthorization(input: { chainId: number; marketSupported: boolean | null; registryMatches: boolean | null;
  placeAuthorized: boolean | null; gasWei: bigint | null; requiredGasWei: bigint | null;
  sufficientMargin: boolean | null; signerControlled: boolean; asOf: number; now: number;
  simulation: boolean | null; walletMatches: boolean }): AuthorizationDecision {
  const blockers: string[] = [];
  if (input.chainId !== 50383) blockers.push('Wrong chain: Hideki 50383 required');
  if (input.marketSupported === false) blockers.push('Unsupported market');
  if (input.registryMatches === false) blockers.push('Pool permission registry differs from official Hideki registry');
  if (input.placeAuthorized === false) blockers.push('No effective placeOrderFor authorization');
  if (input.gasWei !== null && input.requiredGasWei !== null && input.gasWei < input.requiredGasWei) blockers.push('Operator STT below simulated gas cost');
  if (input.sufficientMargin === false) blockers.push('Insufficient MarginBank collateral for this order');
  if (!input.walletMatches) blockers.push('Trading wallet differs from planned owner');
  if (input.now - input.asOf > 30_000 || input.asOf > input.now) blockers.push('Preflight is stale');
  if (input.simulation === false) blockers.push('Call simulation failed');
  if (!input.signerControlled) blockers.push('Perp Canary has no authorized signer or broadcast capability in M2.6');
  const unknown = input.marketSupported === null || input.registryMatches === null || input.placeAuthorized === null ||
    input.gasWei === null || input.requiredGasWei === null || input.sufficientMargin === null || input.simulation === null;
  return { status: blockers.length ? 'BLOCKED' : unknown ? 'UNKNOWN' : 'BLOCKED', blockers,
    nextStep: 'Owner may separately link a public bot address to Wallet 1 for BTC-PERP in dreamDEX, then verify permissions, gas, margin and a fresh simulation. Signing and broadcast require separate M3 approval.' };
}

export async function inspectTradingAuthorization(input: AuthorizationInput) {
  const eoa = input.eoa ? address(input.eoa, 'EOA') : null;
  const owner = address(input.tradingWallet || OWNER_TRADING_WALLET, 'Trading wallet');
  const operator = address(input.operator || HISTORICAL_SENDER, 'Operator');
  const pool = address(input.pool || BTC_POOL, 'Perp pool');
  if ((input.price || input.quantity || input.side) && (!input.price || !input.quantity || !input.side))
    throw Error('Side, price and quantity are all required for an unsigned prototype');
  if (input.side && !['BUY', 'SELL'].includes(input.side)) throw Error('Side must be BUY or SELL');
  if (input.executionMode && !['IOC', 'POST_ONLY'].includes(input.executionMode))
    throw new AuthorizationInputError('Unsupported delegated order mode');
  const head = await readRpcHead();
  const sampledAt = new Date().toISOString();
  const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, async () => {
    const markets = await sdk.client.listPerpMarkets();
    const market = markets.find(row => row.poolAddress.toLowerCase() === pool.toLowerCase());
    const system = market ? await sdk.client.getPerpSystemConfig(market.marginBank).catch(() => null) : null;
    const marketStatus = system ? (await sdk.client.listPerpPoolStatuses({ factory: system.perpPoolFactory }).catch(() => []))
      .find(row => row.pool.toLowerCase() === pool.toLowerCase()) : null;
    const feed = market ? await sdk.client.getPerpFeedStatus(pool).catch(() => null) : null;
    const bookBlock = BigInt(head.blockNumber);
    const blockMeta = market ? await client.getBlock({ blockNumber: bookBlock }).catch(() => null) : null;
    const [book, directBids, directAsks] = market ? await Promise.all([
      sdk.client.getBookTopsOnchain([{ id: pool, poolAddress: pool }],
        { blockNumber: bookBlock }).catch(() => null),
      client.readContract({ address: pool, abi: DIRECT_BOOK_ABI, functionName: 'getBookLevels',
        args: [true, 1n], blockNumber: bookBlock }).catch(() => null),
      client.readContract({ address: pool, abi: DIRECT_BOOK_ABI, functionName: 'getBookLevels',
        args: [false, 1n], blockNumber: bookBlock }).catch(() => null),
    ]) : [null, null, null];
    const postReadBlock = market ? await client.getBlock({ blockNumber: bookBlock }).catch(() => null) : null;
    const top = book?.tops[pool.toLowerCase()];
    const bookTops: MarketBookSnapshot = { market: market ? `${market.baseSymbol}-PERP` : 'UNKNOWN',
      pool, source: BOOK_SOURCE, rpcUrl: RPC,
      blockNumber: book?.blockNumber?.toString() ?? 'UNKNOWN',
      blockHash: blockMeta?.hash ?? 'UNKNOWN',
      postReadBlockHash: postReadBlock?.hash ?? 'UNKNOWN',
      blockTimestamp: blockMeta ? new Date(Number(blockMeta.timestamp) * 1000).toISOString() : 'UNKNOWN',
      observedAt: new Date().toISOString(), quoteDecimals: market?.quoteDecimals,
      tickSizeRaw: market?.tickSize.toString() ?? 'UNKNOWN',
      bestBidRaw: top?.bestBid?.toString() ?? 'UNKNOWN',
      bestAskRaw: top?.bestAsk?.toString() ?? 'UNKNOWN',
      directBestBidRaw: directBids?.[0]?.price.toString() ?? 'UNKNOWN',
      directBestAskRaw: directAsks?.[0]?.price.toString() ?? 'UNKNOWN' };
    const marketIntegrity = validateMarketSnapshot(bookTops, {
      market: market ? `${market.baseSymbol}-PERP` : 'UNKNOWN', pool, sampledBlock: head.blockNumber,
      markPriceRaw: feed?.markPrice?.toString() ?? 'UNKNOWN' });
    const marketSupported = !market ? false : !system || !marketStatus || !feed ? null :
      marketStatus.registered === true && marketStatus.tradeable === true && feed.markPriceOk === true &&
      system.fullyWired === true && market.quoteToken.toLowerCase() === system.collateralToken.toLowerCase();
    const registryRead = await client.readContract({ address: pool, abi: POOL_ABI,
      functionName: 'getOperatorPermissionsRegistry' }).catch(() => null);
    const registryMatches = registryRead === null ? null : registryRead.toLowerCase() === HIDEKI_PERMISSION_REGISTRY.toLowerCase();
    const permissions = await Promise.all(Object.entries(SELECTORS).map(async ([name, selector]) => {
      const effective = await client.readContract({ address: pool, abi: POOL_ABI, functionName: 'isOperatorAuthorized',
        args: [owner, operator, selector as Hex] }).catch(() => null);
      const global = registryMatches === true ? await client.readContract({ address: HIDEKI_PERMISSION_REGISTRY,
        abi: REGISTRY_ABI, functionName: 'isGloballyApproved', args: [owner, operator, selector as Hex] }).catch(() => null) : null;
      const perPool = registryMatches === true ? await client.readContract({ address: HIDEKI_PERMISSION_REGISTRY,
        abi: REGISTRY_ABI, functionName: 'isApprovedForPool', args: [pool, owner, operator, selector as Hex] }).catch(() => null) : null;
      return [name, { selector, effective: check(effective, AUTH_SOURCES.functions),
        global: check(global, AUTH_SOURCES.functions), perPool: check(perPool, AUTH_SOURCES.functions) }] as const;
    }));
    const grants = Object.fromEntries(permissions) as Record<keyof typeof SELECTORS, { selector: string; effective: Check; global: Check; perPool: Check }>;
    const isOwner = eoa ? await client.readContract({ address: owner, abi: OWNER_ABI,
      functionName: 'isOwner', args: [eoa] }).catch(() => null) : null;
    const operatorGas = await client.getBalance({ address: operator }).catch(() => null);
    const margin = market ? await sdk.client.getMarginAccount(market.marginBank, owner).catch(() => null) : null;
    const position = market ? await sdk.client.getPerpPosition({ marginBank: market.marginBank,
      account: owner, pool }).catch(() => null) : null;
    const planBlockers: string[] = [];
    if (input.price && marketIntegrity.status !== 'TRUSTED')
      planBlockers.push(`UNTRUSTED_MARKET_SNAPSHOT: ${marketIntegrity.reasons.join(', ')}`);
    let unsigned: { chainId: number; from: string; to: string; data: Hex; value: string; expiresAt: string } | null = null;
    let simulation: boolean | null = null;
    let requiredGasWei: bigint | null = null;
    let estimatedGasUnits: bigint | null = null;
    let observedGasPriceWei: bigint | null = null;
    let enoughMargin: boolean | null = null;
    let simulationFailure: SimulationFailure | null = null;
    let marginPreview: MarginPreviewDiagnostic = { status: 'NOT_RUN' };
    let maximumPlaceable: MaxPlaceableDiagnostic = { status: 'NOT_RUN' };
    if (input.price && input.quantity && input.side && market) {
      const price = positive(input.price, market.quoteDecimals, 'price');
      const quantity = positive(input.quantity, market.baseDecimals, 'quantity');
      if (input.executionMode === 'POST_ONLY') {
        const opposite = input.side === 'BUY' ? top?.bestAsk : top?.bestBid;
        if (!opposite || (input.side === 'BUY' ? price >= BigInt(opposite) : price <= BigInt(opposite)))
          planBlockers.push('PostOnly price is marketable or opposite book top is unavailable');
        if (!book || book.blockNumber.toString() !== head.blockNumber)
          planBlockers.push('PostOnly book snapshot is not pinned to the sampled block');
      }
      if (price % BigInt(market.tickSize) !== 0n) planBlockers.push('Price is off market tick grid');
      if (quantity % BigInt(market.lotSize) !== 0n || quantity < BigInt(market.minQuantity)) planBlockers.push('Quantity is off market lot grid or below minimum');
      if (!marketSupported) planBlockers.push('Market registration, tradeability, feed or system wiring is not verified');
      if (registryMatches !== true || grants.place.effective.status !== 'SUPPORTED') planBlockers.push('Effective operator permission is unconfirmed');
      if (!margin) planBlockers.push('MarginBank read unavailable');
      if (!planBlockers.length) {
        const [preview, maximum] = await Promise.all([
          sdk.client.previewPerpOrderMargin({ pool, marginBank: market.marginBank,
            account: owner, isBid: input.side === 'BUY', price, quantity }).catch(() => null),
          sdk.client.getMaxPerpOrderSize({ pool, marginBank: market.marginBank,
            account: owner, isBid: input.side === 'BUY', price }).catch(() => null),
        ]);
        marginPreview = !preview ? { status: 'READ_ERROR' } : !preview.priceable ?
          { status: 'UNPRICEABLE', asOfBlock: preview.asOfBlock.toString() } :
          { status: 'OK', asOfBlock: preview.asOfBlock.toString(), sufficient: preview.sufficient,
            hasCollateralForLock: preview.hasCollateralForLock,
            meetsInitialMargin: preview.meetsInitialMargin, voucherBlocked: preview.voucherBlocked,
            restrictedBlocked: preview.restrictedBlocked, isolationBlocked: preview.isolationBlocked,
            lockAmountRaw: preview.lockAmount.toString(),
            unlockedCollateralRaw: preview.unlockedCollateral.toString(), equityRaw: preview.equity.toString(),
            imRequirementRaw: preview.imRequirement.toString(),
            increasingQuantityRaw: preview.increasingQuantity.toString(),
            reducingQuantityRaw: preview.reducingQuantity.toString() };
        maximumPlaceable = !maximum ? { status: 'READ_ERROR' } : !maximum.priceable ?
          { status: 'UNPRICEABLE', asOfBlock: maximum.asOfBlock.toString() } :
          { status: 'OK', asOfBlock: maximum.asOfBlock.toString(), placeable: maximum.placeable,
            maxQuantityRaw: maximum.maxQuantity.toString(), requestedQuantityRaw: quantity.toString(),
            limitedBy: maximum.limitedBy, positionSizeRaw: maximum.positionSize.toString(),
            minQuantityRaw: maximum.minQuantity.toString(), lotSizeRaw: maximum.lotSize.toString() };
        enoughMargin = preview?.priceable === true ? preview.sufficient : null;
        if (enoughMargin !== true) planBlockers.push('Margin preview did not establish sufficient collateral');
        if (maximum?.priceable !== true || !maximum.placeable || quantity > maximum.maxQuantity)
          planBlockers.push(`SDK maximum placeable size unavailable or exceeded${maximum?.priceable ? `: ${maximum.limitedBy}` : ''}`);
      }
      if (!planBlockers.length) {
        const expiresNs = BigInt(Date.now() + PLACE_PLAN_LIFETIME_MS) * 1_000_000n;
        unsigned = { chainId: 50383, from: operator, to: pool, value: '0',
          data: encodeFunctionData({ abi: POOL_ABI, functionName: 'placeOrderFor',
            args: [owner, input.side === 'BUY', 0n, price, quantity, expiresNs,
              input.executionMode === 'POST_ONLY' ? ORDER_TYPE.POST_ONLY : ORDER_TYPE.MARKET, 0, ZERO, 0n] }),
          expiresAt: new Date(Number(expiresNs / 1_000_000n)).toISOString() };
        const gas = await client.estimateGas({ account: operator, to: pool, data: unsigned.data, value: 0n })
          .catch(async (error: unknown) => {
            simulationFailure = classifySimulationFailure(error);
            if (simulationFailure.contractError === 'ImmediateOrCancelNoFill()' && top?.bestAsk)
              simulationFailure.bestAsk = formatUnits(BigInt(top.bestAsk), market.quoteDecimals);
            return null;
          });
        const gasPrice = gas !== null ? await client.getGasPrice().catch(() => null) : null;
        estimatedGasUnits = gas;
        observedGasPriceWei = gasPrice;
        simulation = gas !== null;
        requiredGasWei = gas !== null && gasPrice !== null ? gas * gasPrice : null;
        if (!simulation) planBlockers.push('Read-only eth_estimateGas simulation failed');
        if (operatorGas !== null && requiredGasWei !== null && operatorGas < requiredGasWei)
          planBlockers.push('Operator lacks simulated gas cost');
        if (planBlockers.length) unsigned = null;
      }
    }
    const decision = decideAuthorization({ chainId: head.chainId, marketSupported,
      registryMatches, placeAuthorized: grants.place.effective.status === 'UNKNOWN' ? null : grants.place.effective.status === 'SUPPORTED',
      gasWei: operatorGas, requiredGasWei, sufficientMargin: enoughMargin,
      signerControlled: false, asOf: Date.parse(sampledAt), now: Date.now(), simulation,
      walletMatches: owner.toLowerCase() === (input.tradingWallet ? address(input.tradingWallet, 'Trading wallet') : OWNER_TRADING_WALLET).toLowerCase() });
    return { schema: 'perp-canary/trading-authorization/v1', mode: 'LIVE_READ_ONLY', observedAt: sampledAt,
      rpcUrl: RPC,
      chainId: head.chainId, sampledBlock: head.blockNumber, connectedEoa: eoa ?? 'UNKNOWN',
      tradingWallet: owner, historicalExecutionSigner: HISTORICAL_SENDER, candidateOperator: operator,
      executionSigner: 'UNKNOWN', gasPayer: 'candidate operator if a future transaction is separately authorized',
      isOwner: check(isOwner, 'isOwner on supplied smart wallet; false does not disprove login linkage'),
      pool, market: market ? `${market.baseSymbol}-PERP` : 'UNKNOWN', marketSupported: check(marketSupported, 'Markets SDK factory, feed and system checks'),
      marginBank: market?.marginBank ?? 'UNKNOWN',
      marginBankUnlocked: margin && market ? formatUnits(margin.unlockedCollateralBalance, market.quoteDecimals) : 'UNKNOWN',
      operatorGasStt: operatorGas === null ? 'UNKNOWN' : formatUnits(operatorGas, 18),
      markPriceRaw: feed?.markPrice?.toString() ?? 'UNKNOWN',
      marketGrid: { minQuantityRaw: market?.minQuantity.toString() ?? 'UNKNOWN',
        lotSizeRaw: market?.lotSize.toString() ?? 'UNKNOWN',
        tickSizeRaw: market?.tickSize.toString() ?? 'UNKNOWN',
        baseDecimals: market?.baseDecimals ?? null, quoteDecimals: market?.quoteDecimals ?? null },
      bookTops, marketIntegrity,
      estimatedGasUnits: estimatedGasUnits?.toString() ?? 'UNKNOWN',
      gasPriceWei: observedGasPriceWei?.toString() ?? 'UNKNOWN',
      requiredGasWei: requiredGasWei?.toString() ?? 'UNKNOWN',
      marginSufficient: enoughMargin,
      marginPreview, maximumPlaceable,
      positionSizeRaw: position?.size.toString() ?? 'UNKNOWN',
      registry: registryRead ?? 'UNKNOWN', registryMatches: check(registryMatches, AUTH_SOURCES.perps), permissions: grants,
      revokeCapability: { status: 'SUPPORTED', value: 'Owner can revoke bot permissions in dreamDEX Bots tab; no revoke call is made', source: AUTH_SOURCES.bot },
      unsigned, simulation: check(simulation, 'eth_estimateGas read-only; estimates do not guarantee inclusion'),
      simulationFailure,
      planBlockers, authorization: decision,
      routes: [
        { route: 'External EOA direct', status: 'NOT_RECOMMENDED', reason: 'Own signer, gas and margin required; cannot spend Wallet 1 margin' },
        { route: 'Existing dreamDEX Wallet 1 direct', status: 'BLOCKED', reason: 'Embedded signer is not exposed to Perp Canary' },
        { route: 'Official delegated bot', status: grants.place.effective.status === 'SUPPORTED' ? 'SUPPORTED' : grants.place.effective.status,
          reason: 'Owner-granted selector and market permissions; bot signs and pays gas; Perp Canary has no bot signer' },
        { route: 'Separate SDK wallet', status: 'UNKNOWN', reason: 'Requires separate owner-controlled signer, gas, collateral and eligibility' },
      ],
      limitations: ['Historical sender authorization at M2.5 block does not prove current grant or control of its key.',
        'A successful estimate is not a signature or a guarantee of execution.',
        'M2.6 never signs or broadcasts; unsigned calldata expires quickly and must be rebuilt after fresh preflight.'],
      sources: Object.values(AUTH_SOURCES) };
  }, () => 'reading Hideki operator permissions and margin', 90_000).catch(error => {
    if (error instanceof AuthorizationInputError) throw error;
    throw new AuthorizationReadError();
  });
}
