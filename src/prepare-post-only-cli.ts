import { readBotKeystore } from './bot-keystore.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';
import { buildPreparedPlan } from './delegated-plan.ts';
import { appendBotPlanEvidence } from './bot-evidence.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';

const [side, price, quantity] = process.argv.slice(2);
try {
  if (process.argv.length !== 5 || side !== 'BUY' || !/^\d+(?:\.\d+)?$/.test(price ?? '') ||
    !/^\d+(?:\.\d+)?$/.test(quantity ?? ''))
    throw Error('Usage: npm.cmd run canary-prepare -- BUY <owner-selected-limit> <quantity>');
  const keystore = await readBotKeystore();
  if (!keystore) throw Error('Existing bot keystore metadata unavailable');
  const input = { side: 'BUY' as const, price: price!, quantity: quantity!, executionMode: 'POST_ONLY' as const };
  const observation = await inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
    operator: keystore.address, pool: BTC_POOL, ...input });
  const plan = buildPreparedPlan(observation, input);
  if (plan.status !== 'PREPARED') {
    console.log(JSON.stringify({ status: 'BLOCKED', blockers: plan.blockers,
      bestBidRaw: observation.bookTops.bestBidRaw, bestAskRaw: observation.bookTops.bestAskRaw,
      sampledBlock: observation.sampledBlock, transactionSent: 'NO' }, null, 2));
    process.exitCode = 1;
  } else {
    await appendBotPlanEvidence('bot-evidence', plan);
    console.log(JSON.stringify({ status: plan.status, planHash: plan.hash,
      executionMode: plan.executionMode, side, price, quantity, expiresAt: plan.expiresAt,
      bestBidRaw: plan.bookTops?.bestBidRaw, bestAskRaw: plan.bookTops?.bestAskRaw,
      estimatedGasUnits: plan.risk.estimatedGasUnits, gasLimit: plan.risk.gasLimit,
      maxGasCostWei: plan.risk.maxGasCostWei, orderNotionalWei: plan.risk.orderNotionalWei,
      positionSizeBeforeRaw: plan.positionSizeBeforeRaw, transactionSent: 'NO' }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PostOnly preparation failed');
  process.exitCode = 1;
}
