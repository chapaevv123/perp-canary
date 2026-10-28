import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

function call(port: number, path: string, options: { host?: string; method?: string; origin?: string; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
      setHost: false, headers: { Host: options.host ?? `127.0.0.1:${port}`,
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject); req.end(options.body);
  });
}

test('public mode serves only named routes at exact HTTPS Host and hides diagnostics', async () => {
  const port = 8900 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, CANARY_PORT: String(port),
      CANARY_PUBLIC_ENABLED: '1', CANARY_PUBLIC_ORIGIN: 'https://terminal.example.org' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += String(chunk).slice(0, 500); });
  child.stderr.on('data', chunk => { logs += String(chunk).slice(0, 500); });
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { const response = await call(port, '/api/v1/health', { host: 'terminal.example.org' });
        ready = response.status === 200; if (ready) break;
        logs = `HTTP ${response.status}: ${response.body} ${logs}`.slice(0, 1000);
      } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, logs || `child exit ${child.exitCode}`);
    const home = await call(port, '/', { host: 'terminal.example.org' });
    assert.equal(home.status, 200);
    assert.match(home.body, /data-public-mode="true"/);
    assert.match(String(home.headers['content-security-policy'] ?? ''), /frame-ancestors 'none'/);
    assert.equal((await call(port, '/legacy', { host: 'terminal.example.org' })).status, 403);
    assert.equal((await call(port, '/api/v1/bot-execution', { host: 'terminal.example.org' })).status, 403);
    assert.equal((await call(port, '/api/v1/health')).status, 403);
    const rejected = await call(port, '/api/v1/execution/replay?orderId=invalid',
      { host: 'terminal.example.org' });
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(rejected.body, /verified replay bundle|stack|src\\/);
    assert.equal((await call(port, '/api/v1/intelligence/size', { method: 'POST',
      host: 'terminal.example.org', origin: 'https://evil.example.org', body: '{}' })).status, 403);
  } finally { child.kill(); }
});
