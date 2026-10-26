import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';

type Result = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export type AuthorizationArtifact = {
  schema: 'perp-canary/trading-authorization-evidence/v1'; mode: 'LIVE_READ_ONLY';
  observedAt: string; chainId: number; sampledBlock: string; tradingWallet: string;
  candidateOperator: string; pool: string; registry: string; registryMatches: Result['registryMatches'];
  isOwner: Result['isOwner']; operatorGasStt: string; marginBankUnlocked: string;
  permissions: Result['permissions']; simulation: Result['simulation'];
  planBlockers: string[]; authorization: Result['authorization']; sources: string[]; hash: string;
};
const FILE = /^authorization-\d+\.json$/;
export function createAuthorizationArtifact(result: Result): AuthorizationArtifact {
  const body = { schema: 'perp-canary/trading-authorization-evidence/v1' as const,
    mode: 'LIVE_READ_ONLY' as const, observedAt: result.observedAt, chainId: result.chainId,
    sampledBlock: result.sampledBlock, tradingWallet: result.tradingWallet,
    candidateOperator: result.candidateOperator, pool: result.pool, registry: result.registry,
    registryMatches: result.registryMatches, isOwner: result.isOwner,
    operatorGasStt: result.operatorGasStt, marginBankUnlocked: result.marginBankUnlocked,
    permissions: result.permissions, simulation: result.simulation,
    planBlockers: result.planBlockers, authorization: result.authorization, sources: result.sources };
  return { ...body, hash: sha256(body) };
}
export function verifyAuthorizationArtifact(artifact: AuthorizationArtifact, filename?: string): void {
  const { hash, ...body } = artifact;
  if (body.schema !== 'perp-canary/trading-authorization-evidence/v1' || body.mode !== 'LIVE_READ_ONLY' ||
    body.chainId !== 50383 || !/^\d+$/.test(body.sampledBlock) || !/^0x[0-9a-fA-F]{40}$/.test(body.tradingWallet) ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.candidateOperator) || hash !== sha256(body))
    throw Error('Authorization evidence invalid');
  if (filename && filename !== `authorization-${body.sampledBlock}.json`) throw Error('Authorization evidence filename mismatch');
}
export async function saveAuthorizationArtifact(dir: string, artifact: AuthorizationArtifact): Promise<string> {
  verifyAuthorizationArtifact(artifact);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `authorization-${artifact.sampledBlock}.json`);
  await writeFile(path, `${canonical(artifact)}\n`, { flag: 'wx' });
  return path;
}
export async function readAuthorizationArtifacts(dir: string): Promise<AuthorizationArtifact[]> {
  await mkdir(dir, { recursive: true });
  return Promise.all((await readdir(dir)).filter(name => FILE.test(name)).sort().map(async name => {
    const artifact = JSON.parse(await readFile(join(dir, name), 'utf8')) as AuthorizationArtifact;
    verifyAuthorizationArtifact(artifact, name);
    return artifact;
  }));
}
