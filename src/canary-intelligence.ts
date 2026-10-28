import { formatUnits, parseUnits } from 'viem';
import { customNotionalLimit } from './trading-limit.ts';

export type SizingInput = { capital: string; riskPercent: string; entry: string; stop: string;
  side: 'BUY' | 'SELL';
  baseDecimals: number; quoteDecimals: number; lotSizeRaw: string; minQuantityRaw: string;
  initialMarginBps: number; tickSizeRaw?: string; absoluteRiskUsdso?: string; availableMarginUsdso?: string;
  customMaxNotional?: string };
export function calculatePositionSize(input: SizingInput) {
  const decimal = (value: string) => /^\d+(?:\.\d+)?$/.test(value);
  if (![input.capital, input.entry, input.stop].every(decimal) ||
    !(input.absoluteRiskUsdso ? decimal(input.absoluteRiskUsdso) : decimal(input.riskPercent)) ||
    input.baseDecimals < 1 || input.baseDecimals > 36 || input.quoteDecimals !== 18)
    throw Error('Use positive decimal inputs and verified market precision');
  const capital = parseUnits(input.capital, 18), entry = parseUnits(input.entry, 18),
    stop = parseUnits(input.stop, 18), riskPercent = input.absoluteRiskUsdso ? 0n : parseUnits(input.riskPercent, 4);
  if (capital <= 0n || entry <= 0n || stop <= 0n || entry === stop ||
    (!input.absoluteRiskUsdso && (riskPercent <= 0n || riskPercent > 100n * 10n ** 4n)))
    throw Error('Capital, entry, stop and risk must be valid');
  if (input.tickSizeRaw && (BigInt(input.tickSizeRaw) <= 0n ||
    entry % BigInt(input.tickSizeRaw) !== 0n || stop % BigInt(input.tickSizeRaw) !== 0n))
    throw Error('Entry and invalidation reference must align to the verified tick size');
  if (input.side === 'BUY' ? stop >= entry : input.side === 'SELL' ? stop <= entry : true)
    throw Error('Stop reference must be below BUY entry or above SELL entry');
  const lot = BigInt(input.lotSizeRaw), minimum = BigInt(input.minQuantityRaw);
  if (lot <= 0n || minimum <= 0n || input.initialMarginBps < 1 || input.initialMarginBps > 10_000)
    throw Error('Market grid or margin factor is unverified');
  const riskBudget = input.absoluteRiskUsdso ? parseUnits(input.absoluteRiskUsdso, 18) :
    capital * riskPercent / (100n * 10n ** 4n);
  if (riskBudget <= 0n || riskBudget > capital) throw Error('Risk budget must be positive and no larger than capital');
  const delta = entry > stop ? entry - stop : stop - entry;
  let quantity = riskBudget * 10n ** BigInt(input.baseDecimals) / delta;
  quantity = quantity / lot * lot;
  const notional = quantity * entry / 10n ** BigInt(input.baseDecimals);
  const customMax = customNotionalLimit(input.customMaxNotional);
  const exceedsCustomLimit = customMax !== null && notional > customMax;
  const lossAtStop = quantity * delta / 10n ** BigInt(input.baseDecimals);
  const initialMargin = (notional * BigInt(input.initialMarginBps) + 9999n) / 10_000n;
  const marginAvailable = input.availableMarginUsdso && decimal(input.availableMarginUsdso) ?
    parseUnits(input.availableMarginUsdso, 18) : null;
  return { status: quantity < minimum || notional <= 0n ? 'BELOW_MINIMUM' as const :
    exceedsCustomLimit ? 'EXCEEDS_CUSTOM_LIMIT' as const :
    marginAvailable !== null && initialMargin > marginAvailable ? 'INSUFFICIENT_MARGIN_ESTIMATE' as const : 'CALCULATED' as const,
    confidence: 'ESTIMATED' as const,
    quantity: formatUnits(quantity, input.baseDecimals), quantityRaw: quantity.toString(),
    notionalUsdso: formatUnits(notional, 18), initialMarginUsdso: formatUnits(initialMargin, 18),
    riskBudgetUsdso: formatUnits(riskBudget, 18), lossAtStopUsdso: formatUnits(lossAtStop, 18),
    invalidationDistancePercent: formatUnits(delta * 10_000n / entry, 2),
    marginAvailableUsdso: marginAvailable === null ? null : formatUnits(marginAvailable, 18),
    exceedsCustomLimit,
    maximumMarketLeverageX: 10_000 / input.initialMarginBps,
    assumptions: `Stop is a reference only, not an installed order. Actual loss can exceed this estimate. Excludes funding, liquidation, slippage and fees.${
      exceedsCustomLimit ? ` Calculated quantity exceeds your ${input.customMaxNotional} USDso custom maximum; it was not changed.` : ''}` };
}

export type RadarInput = { status: string; mark: string | null; bid: string | null; ask: string | null;
  bidLevels: Array<{ price: string; quantity: string }>;
  askLevels: Array<{ price: string; quantity: string }>; observedAt: string };
export function assessMarketRadar(current: RadarInput, previous?: RadarInput, now = Date.now()) {
  const age = now - Date.parse(current.observedAt);
  if (current.status !== 'TRUSTED' || !Number.isFinite(age) || age < 0 || age > 30_000 ||
    !current.mark || !current.bid || !current.ask)
    return { status: 'UNKNOWN' as const, spreadBps: null, imbalancePercent: null,
      priceChangeBps: null, alerts: ['Trusted live market data unavailable.'] };
  const bid = Number(current.bid), ask = Number(current.ask), mark = Number(current.mark);
  if (![bid, ask, mark].every(Number.isFinite) || bid <= 0 || ask <= bid || mark <= 0)
    return { status: 'UNKNOWN' as const, spreadBps: null, imbalancePercent: null,
      priceChangeBps: null, alerts: ['Price data is contradictory.'] };
  const spreadBps = (ask - bid) * 10_000 / ((ask + bid) / 2);
  const bidQty = current.bidLevels.reduce((sum, row) => sum + Number(row.quantity), 0);
  const askQty = current.askLevels.reduce((sum, row) => sum + Number(row.quantity), 0);
  const imbalancePercent = bidQty + askQty > 0 ? 100 * bidQty / (bidQty + askQty) : null;
  const priorMark = previous?.status === 'TRUSTED' && previous.mark ? Number(previous.mark) : null;
  const priceChangeBps = priorMark && priorMark > 0 ? (mark - priorMark) * 10_000 / priorMark : null;
  const alerts: string[] = [];
  if (spreadBps > 20) alerts.push(`Spread ${spreadBps.toFixed(1)} bps exceeds the 20 bps watch threshold.`);
  if (imbalancePercent !== null && (imbalancePercent < 25 || imbalancePercent > 75))
    alerts.push(`Top-five book imbalance: bids hold ${imbalancePercent.toFixed(0)}% of visible quantity.`);
  if (priceChangeBps !== null && Math.abs(priceChangeBps) >= 50)
    alerts.push(`Observed mark moved ${priceChangeBps.toFixed(1)} bps since the previous snapshot.`);
  if (imbalancePercent === null) alerts.push('Visible depth is insufficient for an imbalance estimate.');
  return { status: alerts.length ? 'WATCH' as const : 'NORMAL' as const,
    spreadBps, imbalancePercent, priceChangeBps, alerts };
}
