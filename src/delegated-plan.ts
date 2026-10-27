import { decodeFunctionData, getAddress, parseAbi, parseUnits, type Hex } from 'viem';
import { ORDER_TYPE } from '@somnia-chain/markets-sdk';
import { sha256 } from './evidence.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';
import type { SimulationFailure } from './preflight-failure.ts';
import { RPC } from './rpc-health.ts';
import { validateMarketSnapshot, type MarketBookSnapshot } from './market-integrity.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export const PLACE_ABI = parseAbi(['function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool success,uint128 orderId)']);
export const MAX_NOTIONAL_WEI = 100n * 10n ** 18n;
export const MAX_GAS_LIMIT = 10_000_000n;
export const MAX_GAS_COST_WEI = 100_000_000_000_000_000n; // 0.1 STT
export function positionEffect(side: 'BUY' | 'SELL', quantity: string, beforeRaw: string): {
  kind: 'INCREASE_LONG' | 'INCREASE_SHORT' | 'OPEN_LONG' | 'OPEN_SHORT' | 'REDUCE_OR_FLIP';
  afterFullFillRaw: string } {
  const before = BigInt(beforeRaw);
  const delta = parseUnits(quantity, 8) * (side === 'BUY' ? 1n : -1n);
  const kind = before * delta < 0n ? 'REDUCE_OR_FLIP' :
    before > 0n ? 'INCREASE_LONG' : before < 0n ? 'INCREASE_SHORT' :
      delta > 0n ? 'OPEN_LONG' : 'OPEN_SHORT';
  return { kind, afterFullFillRaw: (before + delta).toString() };
}
export type PreparedPlan = { schema: 'perp-canary/delegated-plan/v2'; status: 'PREPARED' | 'BLOCKED';
  operation: 'PLACE'; chainId: 50383; owner: string; operator: string; pool: string;
  side: 'BUY' | 'SELL'; price: string; quantity: string; intentId: string;
  executionMode?: 'POST_ONLY';
  observedAt: string; sampledBlock: string; expiresAt: string; markPriceRaw: string;
  rpcUrl?: string;
  bookTops?: MarketBookSnapshot;
  positionSizeBeforeRaw: string;
  transaction: { from: string; to: string; data: Hex; value: '0' } | null;
  risk: { maxNotionalWei: string; orderNotionalWei: string; gasLimit: string;
    estimatedGasUnits: string; gasPriceWei: string; maxGasCostWei: string; marginBankUnlocked: string };
  checks: { chain: boolean; market: boolean; permission: boolean; margin: boolean;
    gas: boolean; simulation: boolean; fresh: boolean; notional: boolean; targetAndCalldata: boolean };
  blockers: string[]; diagnostic?: { primaryError: string; blockedDependencies: string[];
    failure: SimulationFailure; nextAction: string }; hash: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function validatePlaceCall(data: Hex, input: { owner: string; side: 'BUY' | 'SELL'; price: string;
  quantity: string; expiresAt: string; executionMode?: 'POST_ONLY' }): boolean {
  try {
    const decoded = decodeFunctionData({ abi: PLACE_ABI, data });
    if (decoded.functionName !== 'placeOrderFor') return false;
    const [owner, isBid, userData, price, quantity, expiresNs, orderType, selfMatch, builder, fee] = decoded.args;
    return same(owner, input.owner) && isBid === (input.side === 'BUY') && userData === 0n &&
      price === parseUnits(input.price, 18) && quantity === parseUnits(input.quantity, 8) &&
      expiresNs === BigInt(Date.parse(input.expiresAt)) * 1_000_000n &&
      orderType === (input.executionMode === 'POST_ONLY' ? ORDER_TYPE.POST_ONLY : ORDER_TYPE.MARKET) &&
      selfMatch === 0 && same(builder, '0x0000000000000000000000000000000000000000') && fee === 0n;
  } catch { return false; }
}
export function buildPreparedPlan(observation: Observation, input: { side: 'BUY' | 'SELL'; price: string; quantity: string;
  executionMode?: 'POST_ONLY' },
  now = Date.now()): PreparedPlan {
  const unsigned = observation.unsigned;
  let orderNotional = 0n;
  try { orderNotional = parseUnits(input.price, 18) * parseUnits(input.quantity, 8) / 10n ** 8n; }
  catch { /* Invalid precision remains blocked by the read-only preflight. */ }
  const estimated = /^\d+$/.test(observation.estimatedGasUnits) ? BigInt(observation.estimatedGasUnits) : 0n;
  const gasPrice = /^\d+$/.test(observation.gasPriceWei) ? BigInt(observation.gasPriceWei) : 0n;
  const gasLimit = estimated * 125n / 100n + 100_000n;
  const gasCost = gasLimit * gasPrice;
  const postOnly = input.executionMode === 'POST_ONLY';
  const top = observation.bookTops;
  const integrity = validateMarketSnapshot(top, { market: observation.market,
    pool: observation.pool, sampledBlock: observation.sampledBlock,
    markPriceRaw: observation.markPriceRaw, now });
  let nonMarketable = false;
  try { nonMarketable = integrity.status === 'TRUSTED' && (input.side === 'BUY' ?
    parseUnits(input.price, 18) < BigInt(top!.bestAskRaw) :
    parseUnits(input.price, 18) > BigInt(top!.bestBidRaw)); } catch { /* Fail closed. */ }
  const checks = { chain: observation.chainId === 50383 && (!unsigned || unsigned.chainId === 50383),
    market: integrity.status === 'TRUSTED' && observation.market === 'BTC-PERP' && same(observation.pool, BTC_POOL) &&
      observation.marketSupported.status === 'SUPPORTED' && /^\d+$/.test(observation.markPriceRaw) &&
      BigInt(observation.markPriceRaw) > 0n && /^-?\d+$/.test(observation.positionSizeRaw),
    permission: observation.registryMatches.status === 'SUPPORTED' && observation.permissions.place.effective.status === 'SUPPORTED',
    margin: observation.marginSufficient === true && observation.marginBankUnlocked !== 'UNKNOWN' &&
      !observation.planBlockers.some(blocker => /margin|collateral|placeable|size|voucher/i.test(blocker)),
    gas: gasPrice > 0n && estimated > 0n && gasLimit <= MAX_GAS_LIMIT && gasCost <= MAX_GAS_COST_WEI &&
      observation.operatorGasStt !== 'UNKNOWN' && parseUnits(observation.operatorGasStt === 'UNKNOWN' ? '0' : observation.operatorGasStt, 18) >= gasCost,
    simulation: observation.simulation.status === 'SUPPORTED' && (!postOnly || nonMarketable),
    fresh: now >= Date.parse(observation.observedAt) && now - Date.parse(observation.observedAt) <= 30_000 &&
      !!unsigned && Date.parse(unsigned.expiresAt) > now + 15_000,
    notional: orderNotional > 0n && orderNotional <= MAX_NOTIONAL_WEI,
    targetAndCalldata: !!unsigned && same(unsigned.from, observation.candidateOperator) &&
      same(unsigned.to, BTC_POOL) && unsigned.value === '0' &&
      same(observation.tradingWallet, OWNER_TRADING_WALLET) &&
      validatePlaceCall(unsigned.data, { owner: OWNER_TRADING_WALLET, side: input.side, price: input.price,
        quantity: input.quantity, expiresAt: unsigned.expiresAt, executionMode: input.executionMode }),
  };
  const blockers = [...observation.planBlockers];
  if (!unsigned) blockers.push('Unsigned transaction unavailable; dependent checks NOT_RUN');
  if (integrity.status !== 'TRUSTED')
    blockers.push(`UNTRUSTED_MARKET_SNAPSHOT: ${integrity.reasons.join(', ')}`);
  try {
    if (positionEffect(input.side, input.quantity, observation.positionSizeRaw).kind === 'REDUCE_OR_FLIP')
      blockers.push('Opposite-side PLACE could reduce or flip an existing position; CLOSE_POSITION remains blocked');
  } catch { blockers.push('Position effect unavailable'); }
  const gasMeasured = /^\d+$/.test(observation.estimatedGasUnits) && /^\d+$/.test(observation.gasPriceWei);
  const notRun = !unsigned ? new Set([...(!gasMeasured ? ['gas'] : []),
    ...(observation.simulation.status === 'UNKNOWN' ? ['simulation'] : []),
    'fresh', 'targetAndCalldata']) : new Set<string>();
  for (const [name, passed] of Object.entries(checks))
    if (!passed && !notRun.has(name)) blockers.push(`${name} gate failed`);
  if (postOnly && !nonMarketable) blockers.push('PostOnly order is marketable or book snapshot is stale');
  const failure = observation.simulationFailure as SimulationFailure | null;
  const diagnostic = failure ? {
    primaryError: failure.contractError ?? `${failure.category}: ${failure.details}`,
    blockedDependencies: [...notRun],
    failure, nextAction: failure.nextAction,
  } : undefined;
  const body = { schema: 'perp-canary/delegated-plan/v2' as const,
    status: blockers.length ? 'BLOCKED' as const : 'PREPARED' as const, operation: 'PLACE' as const,
    chainId: 50383 as const, owner: getAddress(OWNER_TRADING_WALLET), operator: observation.candidateOperator,
    pool: getAddress(BTC_POOL), side: input.side, price: input.price, quantity: input.quantity,
    ...(postOnly ? { executionMode: 'POST_ONLY' as const } : {}),
    intentId: sha256({ chainId: 50383, owner: OWNER_TRADING_WALLET.toLowerCase(),
      operator: observation.candidateOperator.toLowerCase(), pool: BTC_POOL.toLowerCase(),
      side: input.side, price: input.price, quantity: input.quantity,
      ...(postOnly ? { executionMode: 'POST_ONLY' } : {}) }),
    observedAt: observation.observedAt, sampledBlock: observation.sampledBlock,
    expiresAt: unsigned?.expiresAt ?? new Date(now).toISOString(), markPriceRaw: observation.markPriceRaw,
    ...(observation.rpcUrl ? { rpcUrl: observation.rpcUrl } : {}),
    ...(observation.bookTops ? { bookTops: observation.bookTops } : {}),
    positionSizeBeforeRaw: observation.positionSizeRaw,
    transaction: unsigned ? { from: unsigned.from, to: unsigned.to, data: unsigned.data, value: '0' as const } : null,
    ...(diagnostic ? { diagnostic } : {}),
    risk: { maxNotionalWei: MAX_NOTIONAL_WEI.toString(), orderNotionalWei: orderNotional.toString(),
      gasLimit: gasLimit.toString(), estimatedGasUnits: estimated.toString(), gasPriceWei: gasPrice.toString(),
      maxGasCostWei: gasCost.toString(), marginBankUnlocked: observation.marginBankUnlocked }, checks, blockers };
  return { ...body, hash: sha256(body) };
}
export function verifyPreparedPlan(plan: PreparedPlan): void {
  const { hash, ...body } = plan;
  let riskValid = false;
  try {
    const gasLimit = BigInt(plan.risk.gasLimit);
    const notional = parseUnits(plan.price, 18) * parseUnits(plan.quantity, 8) / 10n ** 8n;
    riskValid = plan.risk.maxNotionalWei === MAX_NOTIONAL_WEI.toString() &&
      notional > 0n && notional <= MAX_NOTIONAL_WEI &&
      plan.risk.orderNotionalWei === notional.toString() && gasLimit > 0n && gasLimit <= MAX_GAS_LIMIT &&
      BigInt(plan.risk.maxGasCostWei) === gasLimit * BigInt(plan.risk.gasPriceWei) &&
      BigInt(plan.risk.maxGasCostWei) <= MAX_GAS_COST_WEI &&
      /^-?\d+$/.test(plan.positionSizeBeforeRaw) && BigInt(plan.markPriceRaw) > 0n;
    if (riskValid && positionEffect(plan.side, plan.quantity, plan.positionSizeBeforeRaw).kind === 'REDUCE_OR_FLIP')
      riskValid = false;
  } catch { riskValid = false; }
  const expectedIntent = sha256({ chainId: 50383, owner: OWNER_TRADING_WALLET.toLowerCase(),
    operator: plan.operator.toLowerCase(), pool: BTC_POOL.toLowerCase(),
    side: plan.side, price: plan.price, quantity: plan.quantity,
    ...(plan.executionMode === 'POST_ONLY' ? { executionMode: 'POST_ONLY' } : {}) });
  if (plan.schema !== 'perp-canary/delegated-plan/v2' || hash !== sha256(body) ||
    (plan.status === 'PREPARED' && !riskValid) || plan.intentId !== expectedIntent ||
    (plan.status === 'PREPARED' && (plan.blockers.length > 0 || Object.values(plan.checks).some(value => !value))) ||
    (plan.status === 'PREPARED' && (Date.parse(plan.expiresAt) <= Date.parse(plan.observedAt) ||
      Date.parse(plan.expiresAt) - Date.parse(plan.observedAt) > 240_000)) ||
    plan.chainId !== 50383 || plan.operation !== 'PLACE' || !['BUY', 'SELL'].includes(plan.side) ||
    (plan.executionMode !== undefined && plan.executionMode !== 'POST_ONLY') ||
    (plan.rpcUrl !== undefined && plan.rpcUrl !== RPC) ||
    !same(plan.owner, OWNER_TRADING_WALLET) ||
    !same(plan.pool, BTC_POOL) || (plan.status === 'PREPARED' && !plan.transaction) ||
    (plan.transaction && (!same(plan.transaction.to, BTC_POOL) ||
      !same(plan.transaction.from, plan.operator) || plan.transaction.value !== '0' ||
      !validatePlaceCall(plan.transaction.data, plan)))) throw Error('Prepared plan integrity or allowlist failure');
}
