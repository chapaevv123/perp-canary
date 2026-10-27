import { readVerifiedMarket } from '../src/market-registry.ts';
import { prepareDelegatedTrade, readDelegatedAccount } from '../src/delegated-browser-trade.ts';
import { EXPECTED_METAMASK, KNOWN_EMBEDDED } from '../src/wallet-funding.ts';
import { formatUnits, parseUnits } from 'viem';

const account = await readDelegatedAccount(EXPECTED_METAMASK, 'BTC-PERP');
const market = await readVerifiedMarket('BTC-PERP', true);
// One tenth of a percent below the observed bid leaves room for a moving book.
// The prepare path still fetches a new book and blocks a crossing order.
const bidRaw = market.book.bid ? parseUnits(market.book.bid, market.grid.quoteDecimals) : null;
const tick = BigInt(market.grid.tickSizeRaw);
const limit = bidRaw ? formatUnits((bidRaw * 999n / 1000n / tick) * tick,
  market.grid.quoteDecimals) : null;
const result = limit ? await prepareDelegatedTrade({ mode: 'DELEGATED_PERPS',
  account: EXPECTED_METAMASK, owner: KNOWN_EMBEDDED, market: 'BTC-PERP',
  side: 'BUY', orderType: 'POST_ONLY', price: limit, quantity: '0.00013' }) : null;
console.log(JSON.stringify({ observedAt: new Date().toISOString(), block: account.block,
  account: { operator: account.operator, owner: account.owner, gasStt: account.gasStt,
    ownerMarginUsdso: account.marginUnlocked, position: account.position,
    openOrderCount: account.openOrders.length, permissions: account.permissions },
  market: { symbol: market.market.symbol, book: market.book, grid: market.grid },
  smallestPostOnlyBuy: result ? { status: result.status, guard: result.guard,
    marginPreview: result.marginPreview ?? null,
    transaction: result.transaction } : { status: 'BLOCKED', reason: 'No trusted bid' } }, null, 2));
