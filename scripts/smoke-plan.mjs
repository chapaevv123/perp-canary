import { collectPlan } from '../src/execution-live.ts';

const [account, pool, price, quantity] = process.argv.slice(2);
if (!account || !pool || !price || !quantity) {
  console.error('Usage: node --experimental-strip-types scripts/smoke-plan.mjs <public-account> <perp-pool> <limit-price> <base-quantity>');
  process.exitCode = 2;
} else {
  try {
    const plan = await collectPlan({ operation: 'PLACE', account, pool, isBid: true, price, quantity });
    console.log(JSON.stringify({ tier: plan.tier, chainId: plan.chainId, symbol: plan.symbol,
      observedAt: plan.observedAt, blockers: plan.blockers, warnings: plan.warnings,
      method: plan.method, sendEnabled: plan.sendEnabled }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
