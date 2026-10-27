import { readCanaryProof, verifyCanaryProof } from './canary-proof.ts';
import { canaryProofRpc, replayMinedFailure } from './canary-proof-rpc.ts';

try {
  const [path, option] = process.argv.slice(2);
  if ((process.argv.length !== 3 && process.argv.length !== 4) || !path ||
    (option && option !== '--replay'))
    throw Error('Usage: npm.cmd run canary-verify -- <bundle-path> [--replay]');
  const bundle = await readCanaryProof(path);
  const result = await verifyCanaryProof(bundle, canaryProofRpc);
  const historicalReplay = option === '--replay' && result.classification === 'ONCHAIN_REVERT' ?
    await canaryProofRpc.snapshot(bundle.execution.txHash!).then(replayMinedFailure)
      .catch(() => ({ status: 'UNAVAILABLE', reason: 'Historical RPC replay read failed' })) : null;
  console.log(JSON.stringify({ ...result, proofHash: bundle.hash, historicalReplay,
    preflightAttestation: 'LOCAL_PLAN_ONLY',
    recordedActualGasUsed: bundle.risk.actualGasUsed ?? 'UNKNOWN' }, null, 2));
  if (result.verdict === 'FAILED') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Canary verification failed');
  process.exitCode = 1;
}
