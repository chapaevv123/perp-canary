import { readSnapshots } from '../src/evidence.ts';
import { collectFundingIntelligence } from '../src/funding-intelligence.ts';

const snapshots = await readSnapshots('evidence');
const market = snapshots.at(-1)?.markets.find(item => item.symbol === 'BTC-PERP');
if (!market) throw Error('No verified BTC-PERP snapshot market found');
const result = await collectFundingIntelligence({
  eoa: '0x6Fa3659a15e9264E43EC67Fe4Bb5d31D38109A42',
  tradingAccount: '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f',
  pool: market.poolAddress,
  reportedUiAmount: '26.306836', reportedUiSymbol: 'SOMI',
});
console.log(JSON.stringify({ observedAt: result.observedAt, probes: result.probes,
  perps: result.perps, diagnosticsStatus: result.diagnosticsStatus,
  uiAmountComparison: result.uiAmountComparison, fundingReadiness: result.fundingReadiness,
  routes: result.routes, appBalances: result.appBalances }, null, 2));
