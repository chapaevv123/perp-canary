import { formatUnits, parseUnits } from 'viem';
import { readVerifiedMarket } from '../src/market-registry.ts';
import { prepareDelegatedTrade } from '../src/delegated-browser-trade.ts';
import { EXPECTED_METAMASK, KNOWN_EMBEDDED } from '../src/wallet-funding.ts';
import { comparePreflight } from '../web/preflight-compare.js';

const market = await readVerifiedMarket('BTC-PERP', true);
if (market.book.status !== 'TRUSTED' || !market.book.bid) throw Error('No trusted bid');
const tick = BigInt(market.grid.tickSizeRaw);
const bid = parseUnits(market.book.bid, market.grid.quoteDecimals);
const price = formatUnits((bid * 999n / 1000n / tick) * tick, market.grid.quoteDecimals);
const input = { mode: 'DELEGATED_PERPS' as const, account: EXPECTED_METAMASK,
  owner: KNOWN_EMBEDDED, market: 'BTC-PERP', side: 'BUY' as const,
  orderType: 'POST_ONLY' as const, price, quantity: '0.00013' };
const reviewed = await prepareDelegatedTrade(input);
const fresh = reviewed.transaction ? await prepareDelegatedTrade({ ...input,
  expiresAt: Date.parse(reviewed.transaction.expiresAt) }) : null;
const tx = reviewed.transaction, next = fresh?.transaction;
console.log(JSON.stringify({ observedAt: new Date().toISOString(), input,
  reviewed: { status: reviewed.status, block: reviewed.observation.block,
    book: reviewed.observation.book, blockers: reviewed.guard.blockers,
    margin: reviewed.account.marginUnlocked, grant: reviewed.account.permissions.place,
    simulation: tx ? 'PASSED' : 'NOT_PASSED', gas: tx?.gas, nonce: tx?.nonce,
    expiry: tx?.expiresAt },
  fresh: fresh ? { status: fresh.status, block: fresh.observation.block,
    book: fresh.observation.book, blockers: fresh.guard.blockers,
    margin: fresh.account.marginUnlocked, grant: fresh.account.permissions.place,
    simulation: next ? 'PASSED' : 'NOT_PASSED', gas: next?.gas, nonce: next?.nonce,
    expiry: next?.expiresAt } : null,
  browserDecision: fresh ? comparePreflight({ input, result: reviewed }, input, fresh) : null,
  comparison: tx && next ? { sameCalldata: tx.data === next.data,
    sameTarget: tx.to.toLowerCase() === next.to.toLowerCase(),
    sameOperator: tx.from.toLowerCase() === next.from.toLowerCase(),
    sameNonce: tx.nonce === next.nonce, sameGas: tx.gas === next.gas,
    sameExpiry: tx.expiresAt === next.expiresAt } : null }, null, 2));
