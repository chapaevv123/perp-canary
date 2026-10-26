import { inspectTradingAuthorization } from './trading-authorization.ts';
import { createAuthorizationArtifact, saveAuthorizationArtifact } from './authorization-evidence.ts';
import { resolve } from 'node:path';

const prototype = process.argv.includes('--prototype');
const result = await inspectTradingAuthorization({
  eoa: '0x6Fa3659a15e9264E43EC67Fe4Bb5d31D38109A42',
  tradingWallet: '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f',
  ...(prototype ? { side: 'BUY' as const, price: '80440.4', quantity: '0.001' } : {}),
});
if (process.argv.includes('--save')) {
  const artifact = createAuthorizationArtifact(result);
  const path = await saveAuthorizationArtifact(resolve('authorization-evidence'), artifact);
  console.log(JSON.stringify({ path, hash: artifact.hash }));
}
console.log(JSON.stringify({ observedAt: result.observedAt, chainId: result.chainId,
  sampledBlock: result.sampledBlock, isOwner: result.isOwner,
  pool: result.pool, market: result.market, registry: result.registry,
  registryMatches: result.registryMatches, candidateOperator: result.candidateOperator,
  operatorGasStt: result.operatorGasStt, marginBankUnlocked: result.marginBankUnlocked,
  permissions: result.permissions, authorization: result.authorization, routes: result.routes,
  unsigned: result.unsigned, simulation: result.simulation, planBlockers: result.planBlockers }, null, 2));
