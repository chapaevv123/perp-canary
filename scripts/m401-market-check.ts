import { readBotKeystore } from '../src/bot-keystore.ts';
import { inspectTradingAuthorization } from '../src/trading-authorization.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from '../src/trade-forensics.ts';

const keystore = await readBotKeystore();
if (!keystore) throw Error('Existing bot keystore metadata unavailable');
const observed = await inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
  operator: keystore.address, pool: BTC_POOL });
console.log(JSON.stringify({ mode: 'LIVE_READ_ONLY', observedAt: observed.observedAt,
  chainId: observed.chainId, market: observed.market, pool: observed.pool,
  bot: observed.candidateOperator, owner: observed.tradingWallet,
  sampledBlock: observed.sampledBlock, bookTops: observed.bookTops,
  marketIntegrity: observed.marketIntegrity, markPriceRaw: observed.markPriceRaw,
  positionSizeRaw: observed.positionSizeRaw, unlockedMargin: observed.marginBankUnlocked,
  gasStt: observed.operatorGasStt,
  placeGrant: observed.permissions.place.effective.status,
  cancelGrant: observed.permissions.cancel.effective.status,
  transactionSent: 'NO' }, null, 2));
