import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve();
const target = resolve('dist');
await mkdir(target, { recursive: true });
for (const name of ['src', 'web', 'package.json', 'package-lock.json',
  'evidence', 'trade-evidence', 'canary-proofs']) {
  await cp(resolve(root, name), resolve(target, name), { recursive: true, force: true });
}
for (const name of ['authorization-evidence', 'execution-evidence', 'bot-evidence',
  'bot-execution-ledger', 'bot-execution-forensics', 'bot-order-action-forensics']) {
  await mkdir(resolve(target, name), { recursive: true });
}
await mkdir(resolve(target, 'docs/evidence'), { recursive: true });
await cp(resolve(root, 'docs/evidence/verified-delegated-btc-order.json'),
  resolve(target, 'docs/evidence/verified-delegated-btc-order.json'));
const digest = createHash('sha256').update(await readFile(resolve(target, 'web/index.html'))).digest('hex');
await writeFile(resolve(target, 'build-manifest.json'), JSON.stringify({
  schema: 'perp-canary/local-release/v1',
  source: 'local workspace',
  indexSha256: digest,
  runtime: 'Node.js 22.18+',
  note: 'Loopback Node service. Public mode requires an approved HTTPS reverse proxy, CANARY_PUBLIC_ORIGIN and owner approval before deployment.'
}, null, 2) + '\n');
console.log(`Local release package: ${target}`);
console.log('To run: cd dist; npm ci --omit=dev; npm run serve');
