import { formatUnits, parseUnits } from 'viem';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { validateMarketSnapshot } from './market-integrity.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';

export type PriceObservation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export type PriceCandidate = { offsetBps: number; price: string; notional: string;
  status: 'CANDIDATE' | 'BLOCKED'; reasons: string[] };
export type PriceReport = { status: 'READY' | 'BLOCKED'; reasons: string[];
  market: string; sampledBlock: string; observedAt: string; bestBid: string; bestAsk: string;
  mark: string; tick: string; minimumQuantity: string; chosenQuantity: string;
  margin: string; marketIntegrity: PriceObservation['marketIntegrity']; candidates: PriceCandidate[];
  note: string };

const decimal = (v: string) => /^\d+$/.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function ownerBuyLimitReasons(observation: PriceObservation, priceText: string,
  quantityText: string, now = Date.now()): string[] {
  const report = priceReport(observation, now);
  const reasons = [...report.reasons];
  if (!/^\d{1,24}(?:\.\d{1,18})?$/.test(priceText) ||
    !/^\d{1,24}(?:\.\d{1,8})?$/.test(quantityText)) return [...reasons, 'Invalid price or quantity'];
  const price = parseUnits(priceText, 18);
  const quantity = parseUnits(quantityText, 8);
  const tick = decimal(observation.marketGrid.tickSizeRaw) ? BigInt(observation.marketGrid.tickSizeRaw) : 0n;
  const lot = decimal(observation.marketGrid.lotSizeRaw) ? BigInt(observation.marketGrid.lotSizeRaw) : 0n;
  const min = decimal(observation.marketGrid.minQuantityRaw) ? BigInt(observation.marketGrid.minQuantityRaw) : 0n;
  const ask = decimal(observation.bookTops.bestAskRaw) ? BigInt(observation.bookTops.bestAskRaw) : 0n;
  const mark = decimal(observation.markPriceRaw) ? BigInt(observation.markPriceRaw) : 0n;
  if (price <= 0n || tick <= 0n || price % tick !== 0n) reasons.push('BUY limit is off tick grid');
  if (ask <= 0n || price >= ask) reasons.push('PostOnly BUY would cross current Best Ask');
  if (mark <= 0n || (price > mark ? price - mark : mark - price) * 10_000n > mark * 100n)
    reasons.push('BUY limit exceeds 1% of mark');
  if (quantity < min || lot <= 0n || quantity % lot !== 0n) reasons.push('Quantity below minimum or off lot grid');
  const notional = price * quantity / 10n ** 8n;
  if (notional <= 0n) reasons.push('Order notional must be positive');
  // Gross notional is not the initial-margin requirement. The exact SDK preview runs in preparation.
  return reasons;
}
export function priceReport(observation: PriceObservation, now = Date.now()): PriceReport {
  const reasons: string[] = [];
  const grid = observation.marketGrid;
  const book = observation.bookTops;
  const integrity = validateMarketSnapshot(book, { market: observation.market, pool: observation.pool,
    sampledBlock: observation.sampledBlock, markPriceRaw: observation.markPriceRaw, now });
  if (observation.chainId !== 50383 || observation.market !== 'BTC-PERP' ||
    !same(observation.pool, BTC_POOL) || !same(observation.tradingWallet, OWNER_TRADING_WALLET))
    reasons.push('Wrong chain, market, pool or owner');
  if (integrity.status !== 'TRUSTED' || observation.marketIntegrity.status !== 'TRUSTED')
    reasons.push(`UNTRUSTED_MARKET_SNAPSHOT: ${[...integrity.reasons,
      ...observation.marketIntegrity.reasons].join(', ')}`);
  if (now < Date.parse(book.observedAt ?? '') || now - Date.parse(book.observedAt ?? '') > 30_000)
    reasons.push('Book observation is stale');
  if (observation.marketSupported.status !== 'SUPPORTED') reasons.push('BTC-PERP market unavailable');
  if (observation.registryMatches.status !== 'SUPPORTED' ||
    observation.permissions.place.effective.status !== 'SUPPORTED') reasons.push('Bot place permission unavailable');
  if (!/^\d+(?:\.\d+)?$/.test(observation.operatorGasStt) ||
    parseUnits(observation.operatorGasStt, 18) <= 0n) reasons.push('Bot gas balance unavailable or zero');
  if (!decimal(grid.minQuantityRaw) || !decimal(grid.lotSizeRaw) ||
    !decimal(grid.tickSizeRaw) || grid.baseDecimals !== 8 || grid.quoteDecimals !== 18 ||
    BigInt(decimal(grid.lotSizeRaw) ? grid.lotSizeRaw : '0') <= 0n ||
    BigInt(decimal(grid.tickSizeRaw) ? grid.tickSizeRaw : '0') <= 0n)
    reasons.push('Market grid unavailable');
  if (!decimal(book.bestBidRaw) || !decimal(book.bestAskRaw) || !decimal(observation.markPriceRaw) ||
    BigInt(decimal(observation.markPriceRaw) ? observation.markPriceRaw : '0') <= 0n)
    reasons.push('Book or mark unavailable');
  const lot = decimal(grid.lotSizeRaw) ? BigInt(grid.lotSizeRaw) : 0n;
  const min = decimal(grid.minQuantityRaw) ? BigInt(grid.minQuantityRaw) : 0n;
  const tick = decimal(grid.tickSizeRaw) ? BigInt(grid.tickSizeRaw) : 0n;
  const bid = decimal(book.bestBidRaw) ? BigInt(book.bestBidRaw) : 0n;
  const ask = decimal(book.bestAskRaw) ? BigInt(book.bestAskRaw) : 0n;
  const mark = decimal(observation.markPriceRaw) ? BigInt(observation.markPriceRaw) : 0n;
  const quantity = lot > 0n && min > 0n ? (min + lot - 1n) / lot * lot : 0n;
  if (quantity <= 0n) reasons.push('Minimum quantity unavailable');
  const candidates = [10, 25, 50].map(offsetBps => {
    const raw = bid * (10_000n - BigInt(offsetBps)) / 10_000n;
    const price = tick > 0n ? raw / tick * tick : 0n;
    const notional = price * quantity / 10n ** 8n;
    const issues = [...reasons];
    if (price <= 0n || price >= ask || price >= bid) issues.push('Suggested BUY would cross or is not below bid');
    if (mark <= 0n || (price > mark ? price - mark : mark - price) * 10_000n > mark * 100n)
      issues.push('Suggested limit exceeds 1% of mark');
    if (notional <= 0n) issues.push('Order notional must be positive');
    return { offsetBps, price: formatUnits(price, 18), notional: formatUnits(notional, 18),
      status: issues.length ? 'BLOCKED' as const : 'CANDIDATE' as const, reasons: issues };
  });
  return { status: candidates.some(c => c.status === 'CANDIDATE') ? 'READY' : 'BLOCKED',
    reasons, market: observation.market, sampledBlock: observation.sampledBlock,
    observedAt: book.observedAt ?? 'UNKNOWN',
    bestBid: bid > 0n ? formatUnits(bid, 18) : 'UNKNOWN',
    bestAsk: ask > 0n ? formatUnits(ask, 18) : 'UNKNOWN',
    mark: mark > 0n ? formatUnits(mark, 18) : 'UNKNOWN',
    tick: tick > 0n ? formatUnits(tick, 18) : 'UNKNOWN',
    minimumQuantity: min > 0n ? formatUnits(min, 8) : 'UNKNOWN',
    chosenQuantity: quantity > 0n ? formatUnits(quantity, 8) : 'UNKNOWN',
    margin: observation.marginBankUnlocked, marketIntegrity: integrity,
    candidates, note: 'Candidate prices use fresh best bid minus 10/25/50 bps, rounded down to tick. They do not guarantee no later fill. Full margin, gas and simulation gates run during preparation and check.' };
}
