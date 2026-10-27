import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import test from 'node:test';
import { classifyLifecycle, publicProof, readFirstProof, type LifecycleEvent } from '../src/terminal-data.ts';

test('first proof API projection contains the exact validated receipt and no signing material', async () => {
  const bundle = await readFirstProof();
  const proof = publicProof(bundle);
  assert.equal(proof.planHash.length, 64);
  assert.equal(proof.orderId, '14978756187852164026332');
  assert.equal(proof.block, '34465778');
  assert.equal(proof.gasUsed, '995957');
  assert.equal(proof.proofHash, bundle.hash);
  assert.doesNotMatch(JSON.stringify(proof), /privateKey|password|signedTransaction|"input"/i);
  const tampered = structuredClone(bundle);
  tampered.execution.snapshot!.receipt!.status = '0x0';
  assert.throws(() => publicProof(tampered), /SHA-256|receipt/i);
});

test('order disappearance stays UNKNOWN without a matching terminal event', () => {
  const base: LifecycleEvent[] = [{ name: 'OrderRested', block: '1', txHash: '0x1',
    logIndex: 0, quantityRaw: null, source: 'VERIFIED_PROOF' }];
  assert.deepEqual(classifyLifecycle(base, false), { state: 'NOT_OPEN_AT_READ', cause: 'UNKNOWN', filledRaw: '0' });
  assert.equal(classifyLifecycle([...base, { ...base[0]!, name: 'OrderExpired' }], false).cause, 'OrderExpired');
  assert.equal(classifyLifecycle([...base, { ...base[0]!, name: 'OrderFilled', quantityRaw: '5000' }], false).cause,
    'FILL_OBSERVED_CAUSE_UNCONFIRMED');
  assert.equal(classifyLifecycle(base, null).state, 'UNKNOWN');
});

test('terminal HTML exposes honest read-only controls and live chart', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const js = await readFile('web/terminal.js', 'utf8');
  for (const id of ['chart', 'book-bid', 'book-ask', 'gate-grid', 'timeline', 'proof-hash',
    'copy-active-plan', 'copy-execute', 'copy-confirmation', 'use-bid', 'use-ask']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /BROWSER READ-ONLY/);
  assert.match(html, /SELL \/ SHORT<\/button>/);
  assert.match(html, /No historical candles are invented/);
  assert.match(js, /state\.observations\.push\(/);
  assert.match(js, /Date\.now\(\) < Date\.parse\(state\.plan\.expiresAt\)/);
  assert.doesNotMatch(js, /bot-plan|bot-execute.*fetch|privateKey|password/i);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Expected local TCP address');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test('terminal HTTP serves sanitized proof and read-only home without RPC', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'],
    { cwd: process.cwd(), env: { ...process.env, CANARY_PORT: String(port) }, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    let response: Response | null = null;
    for (let i = 0; i < 30; i++) {
      try { response = await fetch(`${base}/api/v1/terminal/proof`); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(response, 'local server started');
    assert.equal(response.status, 200);
    const proof = await response.json() as Record<string, unknown>;
    assert.equal(proof.orderId, '14978756187852164026332');
    assert.equal(proof.placement, 'VERIFIED');
    assert.equal((await fetch(base)).status, 200);
    assert.match(await (await fetch(base)).text(), /BROWSER READ-ONLY/);
    assert.equal((await fetch(`${base}/terminal.css`)).status, 200);
    assert.equal((await fetch(`${base}/terminal.js`)).status, 200);
    const plan = await fetch(`${base}/api/v1/terminal/plan`);
    assert.equal(plan.status, 200);
    assert.equal(await plan.json(), null);
  } finally { child.kill(); }
});
