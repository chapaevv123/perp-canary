import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

async function reader(status: number, contentType: string, body: string) {
  const window: { canaryReadJson?: (url: string, options?: unknown) => Promise<unknown> } = {};
  const calls = { text: 0 };
  const fetch = async () => ({ status, ok: status >= 200 && status < 300,
    headers: { get: () => contentType }, text: async () => { calls.text++; return body; } });
  const script = await readFile('web/legacy.js', 'utf8');
  const functionSource = script.match(/^async function readJson\(url,options\).*$/m)?.[0];
  assert.ok(functionSource, 'legacy readJson must remain available without bundling');
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

test('funding view rejects HTML and JSON HTTP errors before rendering balances', async () => {
  const script = await readFile('web/funding.js', 'utf8');
  const source = script.match(/ {2}async function readFundingJson\(options\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(source);
  const window: { read?: (options: unknown) => Promise<unknown> } = {};
  let parsed = 0;
  const fetch = async () => ({ status: 404, ok: false, headers: { get: () => 'text/html' },
    text: async () => { parsed++; return '<html>old server</html>'; } });
  runInNewContext(`${source}\nwindow.read=readFundingJson`, { window, fetch });
  await assert.rejects(window.read!({ method: 'POST' }), /non-JSON HTTP 404/);
  assert.equal(parsed, 0);
  const errorWindow: { read?: (options: unknown) => Promise<unknown> } = {};
  const jsonFetch = async () => ({ status: 503, ok: false, headers: { get: () => 'application/json' },
    text: async () => '{"error":"RPC read unavailable"}' });
  runInNewContext(`${source}\nwindow.read=readFundingJson`, { window: errorWindow, fetch: jsonFetch });
  await assert.rejects(errorWindow.read!({ method: 'POST' }), /RPC read unavailable/);
});

test('forensics view never parses a stale-server HTML error as JSON', async () => {
  const script = await readFile('web/forensics.js', 'utf8');
  const source = script.match(/ {2}async function readForensicsJson\(options\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(source);
  const window: { read?: (options: unknown) => Promise<unknown> } = {};
  let parsed = 0;
  const fetch = async () => ({ status: 404, ok: false, headers: { get: () => 'text/html' },
    text: async () => { parsed++; return '<html>stale route</html>'; } });
  runInNewContext(`${source}\nwindow.read=readForensicsJson`, { window, fetch });
  await assert.rejects(window.read!({ method: 'POST' }), /non-JSON HTTP 404/);
  assert.equal(parsed, 0);
});
