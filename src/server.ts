import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appendSnapshot, readSnapshots } from './evidence.ts';
import { appendExecutionRecord, readExecutionRecords } from './execution-evidence.ts';
import { collectPlan, observeReceipt } from './execution-live.ts';
import { assessExecution, type ExecutionPlan } from './execution.ts';
import { collectLive } from './live.ts';

const evidenceDir = resolve('evidence');
const htmlPath = resolve('web/index.html');
const executionDir = resolve('execution-evidence');
let refreshing = false;
const port = Number(process.env.CANARY_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CANARY_PORT');

async function jsonBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Content-Type must be application/json');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > 8192) throw new Error('Request body exceeds 8 KiB');
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
  return body as Record<string, unknown>;
}

function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  try {
    if (request.method === 'POST' && request.headers.origin &&
      ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) {
      json(response, 403, { error: 'Cross-origin writes are blocked' }); return;
    }
    if (request.method === 'POST' && path === '/api/v1/snapshot') {
      if (refreshing) { json(response, 409, { error: 'A snapshot refresh is already running' }); return; }
      refreshing = true;
      try {
        const body = await collectLive();
        const file = await appendSnapshot(evidenceDir, body);
        json(response, 200, { file, blockNumber: body.blockNumber, markets: body.markets.length });
      } finally { refreshing = false; }
    } else if (request.method === 'POST' && path === '/api/v1/plan') {
      const body = await jsonBody(request);
      const plan = await collectPlan({ operation: body.operation as 'PLACE' | 'CANCEL' | 'CLOSE',
        account: String(body.account ?? ''), pool: String(body.pool ?? ''), isBid: body.isBid as boolean | undefined,
        price: body.price === undefined ? undefined : String(body.price),
        quantity: body.quantity === undefined ? undefined : String(body.quantity),
        orderId: body.orderId === undefined ? undefined : String(body.orderId) });
      const record = await appendExecutionRecord(executionDir, 'PLAN', plan);
      json(response, 200, { ...record, state: plan.blockers.length ? 'BLOCKED' : 'DRY_RUN_READY' });
    } else if (request.method === 'POST' && path === '/api/v1/reconcile') {
      const body = await jsonBody(request);
      const records = await readExecutionRecords(executionDir);
      const parent = records.find(record => record.kind === 'PLAN' && record.hash === body.planHash);
      if (!parent) throw new Error('Verified plan hash not found');
      const plan = parent.payload as ExecutionPlan;
      const txHash = String(body.txHash ?? '');
      const previous = records.find(record => record.kind === 'RECONCILIATION' &&
        (record.payload as { planHash?: string; receipt?: { txHash?: string } }).planHash === parent.hash &&
        (record.payload as { receipt?: { txHash?: string } }).receipt?.txHash?.toLowerCase() === txHash.toLowerCase());
      if (previous) { json(response, 200, previous); return; }
      const receipt = await observeReceipt(plan, txHash);
      const assessment = assessExecution(plan, receipt);
      const record = await appendExecutionRecord(executionDir, 'RECONCILIATION',
        { planHash: parent.hash, receipt, assessment });
      json(response, 200, record);
    } else if (request.method === 'GET' && path === '/api/v1/execution') {
      const records = await readExecutionRecords(executionDir);
      json(response, 200, { records, head: records.at(-1)?.hash ?? null });
    } else if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(htmlPath));
    } else if (request.method === 'GET' && (path === '/api/v1/snapshots' || path === '/api/v1/latest')) {
      const history = await readSnapshots(evidenceDir);
      const value = path.endsWith('/latest') ? history.at(-1) ?? null : history;
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(value));
    } else if (request.method === 'GET' && path === '/api/v1/gate') {
      const history = await readSnapshots(evidenceDir);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ gate: 'UNKNOWN', reason: 'Execution availability and order conformance are not measured yet',
        latestEvidenceHash: history.at(-1)?.hash ?? null }));
    } else if (request.method === 'GET' && path === '/api/v1/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ service: 'perp-canary', mode: 'READ_ONLY', evidence: 'LOCAL_VERIFIED_FILES',
        transactionSending: 'DISABLED' }));
    } else {
      response.writeHead(404); response.end('Not found');
    }
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, '127.0.0.1', () => console.log(`Perp Canary http://127.0.0.1:${port}`));
