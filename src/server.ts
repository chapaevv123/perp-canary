import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readSnapshots } from './evidence.ts';

const evidenceDir = resolve('evidence');
const htmlPath = resolve('web/index.html');
const port = Number(process.env.CANARY_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CANARY_PORT');

createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  try {
    if (path === '/' || path === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(htmlPath));
    } else if (path === '/api/v1/snapshots' || path === '/api/v1/latest') {
      const history = await readSnapshots(evidenceDir);
      const value = path.endsWith('/latest') ? history.at(-1) ?? null : history;
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(value));
    } else if (path === '/api/v1/gate') {
      const history = await readSnapshots(evidenceDir);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ gate: 'UNKNOWN', reason: 'Execution availability and order conformance are not measured yet',
        latestEvidenceHash: history.at(-1)?.hash ?? null }));
    } else if (path === '/api/v1/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ service: 'perp-canary', mode: 'READ_ONLY', evidence: 'LOCAL_VERIFIED_FILES' }));
    } else {
      response.writeHead(404); response.end('Not found');
    }
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, '127.0.0.1', () => console.log(`Perp Canary http://127.0.0.1:${port}`));
