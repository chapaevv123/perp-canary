/* global fetch, AbortSignal */
// Bounded transport checks; no wallet, signing or transaction methods.
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const WS = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';

const result = {};
const category = error => {
  const cause = error?.cause ?? error;
  return { name: error?.name ?? 'Error', code: cause?.code ?? null,
    message: String(error?.message ?? error).slice(0, 180) };
};
async function rpc(method, params = []) {
  const response = await fetch(RPC, { method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (!response.ok || body.error) throw Error(`HTTP ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 160)}`);
  return body.result;
}
async function websocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS);
    const timer = setTimeout(() => { socket.close(); reject(Error('WebSocket timeout')); }, 12000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'eth_chainId', params: [] })));
    socket.addEventListener('message', event => {
      try { const data = JSON.parse(String(event.data));
        if (data.id !== 1) return;
        clearTimeout(timer); socket.close();
        if (data.error) reject(Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('WebSocket connection failed')); });
  });
}
async function indexer() {
  const response = await fetch(INDEXER, { method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query { __typename }' }) });
  const body = await response.json();
  if (!response.ok || body.errors) throw Error(`HTTP ${response.status}: ${JSON.stringify(body.errors ?? body).slice(0, 160)}`);
  return body.data?.__typename;
}
for (const [name, work] of [
  ['HTTP_RPC', async () => ({ chainId: Number(await rpc('eth_chainId')),
    block: Number(await rpc('eth_blockNumber')) })],
  ['WEBSOCKET_RPC', async () => ({ chainId: Number(await websocket()) })],
  ['GRAPHQL_INDEXER', async () => ({ typename: await indexer() })],
]) {
  try { result[name] = { status: 'OK', ...(await work()) }; }
  catch (error) { result[name] = { status: 'FAILED', ...category(error) }; }
}
console.log(JSON.stringify(result, null, 2));
