import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { ForensicsBody } from './trade-forensics.ts';

export type TradeArtifact = ForensicsBody & { hash: string };
const FILE = /^tx-([0-9a-f]{64})\.json$/;

export function verifyTradeArtifact(artifact: TradeArtifact, filename?: string): void {
  const { hash, ...body } = artifact;
  if (body.schema !== 'perp-canary/trade-forensics/v1' || body.mode !== 'LIVE_READ_ONLY' ||
    !/^0x[0-9a-f]{64}$/.test(body.txHash) || hash !== sha256(body)) throw Error('Trade evidence hash invalid');
  if (filename && filename !== `tx-${body.txHash.slice(2)}.json`) throw Error('Trade evidence filename mismatch');
  if (body.transaction && body.transaction.hash.toLowerCase() !== body.txHash) throw Error('Trade transaction hash mismatch');
  if (body.receipt && body.receipt.transactionHash.toLowerCase() !== body.txHash) throw Error('Trade receipt hash mismatch');
  if (body.transaction && body.receipt && body.transaction.blockHash.toLowerCase() !== body.receipt.blockHash.toLowerCase())
    throw Error('Trade block hash mismatch');
}

export async function readTradeArtifacts(dir: string): Promise<TradeArtifact[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(name => FILE.test(name)).sort();
  return Promise.all(files.map(async filename => {
    const artifact = JSON.parse(await readFile(join(dir, filename), 'utf8')) as TradeArtifact;
    verifyTradeArtifact(artifact, filename);
    return artifact;
  }));
}

export async function saveTradeArtifact(dir: string, artifact: TradeArtifact): Promise<string> {
  verifyTradeArtifact(artifact);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `tx-${artifact.txHash.slice(2)}.json`);
  await writeFile(path, `${canonical(artifact)}\n`, { flag: 'wx' });
  return path;
}
