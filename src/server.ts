import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appendSnapshot, readSnapshots } from './evidence.ts';
import { appendExecutionRecord, readExecutionRecords } from './execution-evidence.ts';
import { collectPlan, observeReceipt } from './execution-live.ts';
import { assessExecution, type ExecutionPlan } from './execution.ts';
import { collectLive } from './live.ts';
import { PreflightError } from './rpc-health.ts';
import { inspectWalletArchitecture, WalletDiagnosticsReadError } from './wallet-diagnostics.ts';
import { collectFundingIntelligence } from './funding-intelligence.ts';
import { collectTradeForensics } from './trade-forensics.ts';
import { readTradeArtifacts } from './trade-evidence.ts';
import { inspectTradingAuthorization, AuthorizationReadError } from './trading-authorization.ts';
import { readBotKeystore } from './bot-keystore.ts';
import { inspectBotConnection } from './bot-foundation.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { appendBotPlanEvidence } from './bot-evidence.ts';
import { readBotPlanEvidence } from './bot-evidence.ts';
import { buildPreparedPlan } from './delegated-plan.ts';
import { readExecutionLedger } from './execution-ledger.ts';
import { readForensicEvidence } from './delegated-forensics.ts';
import { localRequestRejection } from './server-security.ts';

const evidenceDir = resolve('evidence');
const htmlPath = resolve('web/index.html');
const walletJsPath = resolve('web/wallet.js');
const fundingJsPath = resolve('web/funding.js');
const forensicsJsPath = resolve('web/forensics.js');
const authorizationJsPath = resolve('web/authorization.js');
const botJsPath = resolve('web/bot.js');
const tradeEvidenceDir = resolve('trade-evidence');
const executionDir = resolve('execution-evidence');
const botEvidenceDir = resolve('bot-evidence');
const botExecutionLedgerDir = resolve('bot-execution-ledger');
const botForensicDir = resolve('bot-execution-forensics');
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
    const rejection = localRequestRejection({ host: request.headers.host, origin: request.headers.origin,
      fetchSite: request.headers['sec-fetch-site'], method: request.method }, port);
    if (rejection) { json(response, 403, { error: rejection }); return; }
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
    } else if (path === '/api/v1/wallet-diagnostics' && request.method !== 'POST') {
      json(response, 405, { error: 'Use POST /api/v1/wallet-diagnostics with a JSON body' });
    } else if (request.method === 'POST' && path === '/api/v1/wallet-diagnostics') {
      const body = await jsonBody(request);
      const result = await inspectWalletArchitecture({
        eoa: typeof body.eoa === 'string' ? body.eoa : undefined,
        tradingAccount: typeof body.tradingAccount === 'string' ? body.tradingAccount : undefined,
        pool: typeof body.pool === 'string' ? body.pool : '',
        txHash: typeof body.txHash === 'string' ? body.txHash : undefined,
      });
      json(response, 200, result);
    } else if (path === '/api/v1/network-funding' && request.method !== 'POST') {
      json(response, 405, { error: 'Use POST /api/v1/network-funding with a JSON body' });
    } else if (request.method === 'POST' && path === '/api/v1/network-funding') {
      const body = await jsonBody(request);
      const result = await collectFundingIntelligence({
        eoa: typeof body.eoa === 'string' ? body.eoa : undefined,
        tradingAccount: typeof body.tradingAccount === 'string' ? body.tradingAccount : undefined,
        pool: typeof body.pool === 'string' ? body.pool : undefined,
        reportedUiAmount: typeof body.reportedUiAmount === 'string' ? body.reportedUiAmount : undefined,
        reportedUiSymbol: typeof body.reportedUiSymbol === 'string' ? body.reportedUiSymbol : undefined,
      });
      json(response, 200, result);
    } else if (path === '/api/v1/trade-forensics' && request.method !== 'POST') {
      json(response, 405, { error: 'Use POST /api/v1/trade-forensics with a JSON body' });
    } else if (request.method === 'POST' && path === '/api/v1/trade-forensics') {
      const body = await jsonBody(request);
      const result = await collectTradeForensics({ txHash: typeof body.txHash === 'string' ? body.txHash : '',
        tradingWallet: typeof body.tradingWallet === 'string' ? body.tradingWallet : '' });
      const saved = (await readTradeArtifacts(tradeEvidenceDir))
        .find(artifact => artifact.txHash.toLowerCase() === result.txHash.toLowerCase());
      json(response, 200, { ...result, savedEvidenceHash: saved?.hash ?? null });
    } else if (path === '/api/v1/trading-authorization' && request.method !== 'POST') {
      json(response, 405, { error: 'Use POST /api/v1/trading-authorization with a JSON body' });
    } else if (request.method === 'POST' && path === '/api/v1/trading-authorization') {
      const body = await jsonBody(request);
      if (body.side !== undefined && body.side !== '' && body.side !== 'BUY' && body.side !== 'SELL')
        throw new Error('Side must be BUY or SELL');
      const result = await inspectTradingAuthorization({
        eoa: typeof body.eoa === 'string' ? body.eoa : undefined,
        tradingWallet: typeof body.tradingWallet === 'string' ? body.tradingWallet : undefined,
        operator: typeof body.operator === 'string' ? body.operator : undefined,
        pool: typeof body.pool === 'string' ? body.pool : undefined,
        side: body.side === 'BUY' || body.side === 'SELL' ? body.side : undefined,
        price: typeof body.price === 'string' ? body.price : undefined,
        quantity: typeof body.quantity === 'string' ? body.quantity : undefined,
      });
      json(response, 200, result);
    } else if (request.method === 'GET' && path === '/api/v1/bot-connection') {
      json(response, 200, await inspectBotConnection());
    } else if (request.method === 'POST' && path === '/api/v1/bot-plan') {
      const body = await jsonBody(request);
      if (body.side !== 'BUY' && body.side !== 'SELL') throw new Error('Side must be BUY or SELL');
      if (typeof body.price !== 'string' || typeof body.quantity !== 'string') throw new Error('Price and quantity required');
      const keystore = await readBotKeystore();
      if (!keystore) { json(response, 409, { status: 'NOT_CONFIGURED', error: 'Local bot keystore is not configured' }); return; }
      const connection = await inspectBotConnection();
      if (connection.status !== 'ON_CHAIN_LINK_OBSERVED') {
        json(response, 409, { status: connection.status, error: 'Effective market permission is not verified' }); return;
      }
      const observation = await inspectTradingAuthorization({ operator: keystore.address,
        tradingWallet: OWNER_TRADING_WALLET, pool: BTC_POOL, side: body.side,
        price: body.price, quantity: body.quantity });
      const plan = buildPreparedPlan(observation, { side: body.side, price: body.price, quantity: body.quantity });
      const record = await appendBotPlanEvidence(botEvidenceDir, plan);
      json(response, 200, { ...plan, evidenceHash: record.hash });
    } else if (request.method === 'GET' && path === '/api/v1/bot-execution') {
      const plans = await readBotPlanEvidence(botEvidenceDir);
      const forensic = await readForensicEvidence(botForensicDir);
      const rows = await Promise.all(plans.filter(p => p.plan.schema === 'perp-canary/delegated-plan/v2')
        .slice(-20).map(async record => {
          if (record.plan.schema !== 'perp-canary/delegated-plan/v2') throw Error('Plan schema mismatch');
          const plan = record.plan;
          return { plan, history: await readExecutionLedger(botExecutionLedgerDir, plan.intentId),
            forensic: forensic.filter(f => f.planHash === plan.hash) };
        }));
      json(response, 200, { rows });
    } else if (request.method === 'GET' && path.startsWith('/api/v1/bot-evidence/')) {
      const hash = path.slice('/api/v1/bot-evidence/'.length);
      if (!/^[0-9a-f]{64}$/.test(hash)) throw Error('Invalid evidence hash');
      const record = (await readForensicEvidence(botForensicDir)).find(item => item.hash === hash);
      if (!record) { json(response, 404, { error: 'Evidence not found' }); return; }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${hash}.json"`, 'cache-control': 'no-store' });
      response.end(JSON.stringify(record));
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
    } else if (request.method === 'GET' && path === '/wallet.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(walletJsPath));
    } else if (request.method === 'GET' && path === '/funding.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(fundingJsPath));
    } else if (request.method === 'GET' && path === '/forensics.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(forensicsJsPath));
    } else if (request.method === 'GET' && path === '/authorization.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(authorizationJsPath));
    } else if (request.method === 'GET' && path === '/bot.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(botJsPath));
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
      response.end(JSON.stringify({ service: 'perp-canary', mode: 'READ_ONLY_HTTP', evidence: 'LOCAL_VERIFIED_FILES',
        transactionSending: 'LOCAL_OWNER_CONFIRMED_CLI_ONLY' }));
    } else if (path.startsWith('/api/')) {
      json(response, 404, { error: 'API route not found. Restart the Perp Canary server if this page was just updated.' });
    } else {
      response.writeHead(404); response.end('Not found');
    }
  } catch (error) {
    if (error instanceof PreflightError) {
      json(response, 503, { error: error.message, code: error.code, phase: error.phase,
        transport: error.transport, attempts: error.attempts, retryable: true });
    } else if (error instanceof WalletDiagnosticsReadError) {
      json(response, 503, { error: error.message, code: 'WALLET_DIAGNOSTICS_UNAVAILABLE', phase: error.phase });
    } else if (error instanceof AuthorizationReadError) {
      json(response, 503, { error: error.message, code: 'AUTHORIZATION_READ_UNAVAILABLE', retryable: true });
    } else {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}).listen(port, '127.0.0.1', () => console.log(`Perp Canary http://127.0.0.1:${port}`));
