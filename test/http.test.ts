import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

async function reader(status: number, contentType: string, body: string) {
  const window: { canaryReadJson?: (url: string, options?: unknown) => Promise<unknown> } = {};
  const calls = { text: 0 };
  const fetch = async () => ({ status, ok: status >= 200 && status < 300,
    headers: { get: () => contentType }, text: async () => { calls.text++; return body; } });
  const html = await readFile('web/index.html', 'utf8');
  const functionSource = html.match(/^async function readJson\(url,options\).*$/m)?.[0];
  assert.ok(functionSource, 'readJson must stay inline so an older server can serve it');
  runInNewContext(`${functionSource}\nwindow.canaryReadJson=readJson`, { window, fetch });
  return { read: window.canaryReadJson!, calls };
}

test('stale server plain-text 404 is reported without parsing its body', async () => {
  const { read, calls } = await reader(404, 'text/plain', 'Not found');
  await assert.rejects(read('/api/v1/wallet-diagnostics', { method: 'POST' }), /Restart the Perp Canary server/);
  assert.equal(calls.text, 0);
});

test('HTML success is rejected safely instead of being parsed as JSON', async () => {
  const { read, calls } = await reader(200, 'text/html', '<!doctype html>');
  await assert.rejects(read('/api/v1/wallet-diagnostics'), /non-JSON response/);
  assert.equal(calls.text, 0);
});

test('JSON errors and malformed JSON have clear status', async () => {
  const failure = await reader(503, 'application/json; charset=utf-8', '{"error":"RPC_TIMEOUT during MarginBank read"}');
  await assert.rejects(failure.read('/api/v1/wallet-diagnostics'), /RPC_TIMEOUT during MarginBank read/);
  const malformed = await reader(200, 'application/json', '<broken>');
  await assert.rejects(malformed.read('/api/v1/wallet-diagnostics'), /invalid JSON \(HTTP 200\)/);
});
