import { readFile } from 'node:fs/promises';
import { createPublicClient, formatUnits, http, parseAbi, type Hex } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { validateCanaryProof, type CanaryProofBundle } from './canary-proof.ts';
import { BTC_POOL, OWNER_TRADING_WALLET, decodeKnownLogs } from './trade-forensics.ts';
import { RPC } from './rpc-health.ts';
import { discoverBtcOrders } from './order-actions.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';

export const FIRST_PROOF_FILE = 'canary-proofs/canary-proof-1793098877887-4230656d134c.json';
export const FIRST_ORDER_ID = '14978756187852164026332';
export const FIRST_PROOF_HASH = '4230656d134ca6644edfbbcd5ec97468e8381e672c78bdb5ddd5730518d20e92';
const FIRST_BLOCK = 34465778n;
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
const depthAbi = parseAbi(['function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])']);
let ownerDiscoveryInFlight: ReturnType<typeof discoverBtcOrders> | null = null;
function discoverOwnerOnce() {
  if (!ownerDiscoveryInFlight) ownerDiscoveryInFlight = discoverBtcOrders().finally(() => {
    ownerDiscoveryInFlight = null;
  });
  return ownerDiscoveryInFlight;
}

export function publicProof(bundle: CanaryProofBundle) {
  validateCanaryProof(bundle);
  const receipt = bundle.execution.snapshot?.receipt;
  if (bundle.hash !== FIRST_PROOF_HASH ||
    bundle.planHash !== 'c48415ec3cc8cba6392294529f650c4be7a925b66f5f4b03f33eb6ad9cd52ed2' ||
    bundle.execution.txHash !== '0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121' ||
    receipt?.status !== '0x1' || receipt.blockNumber !== FIRST_BLOCK.toString())
    throw Error('First proof identity or receipt mismatch');
  const events = decodeKnownLogs(receipt).events;
  const placed = events.find(e => e.eventName === 'OrderPlaced' && String(e.args.orderId) === FIRST_ORDER_ID &&
    String((e.args.placedOrder as { owner?: string })?.owner).toLowerCase() === OWNER_TRADING_WALLET.toLowerCase());
  const rested = events.find(e => e.eventName === 'OrderRested' && String(e.args.orderId) === FIRST_ORDER_ID);
  if (!placed || !rested || !receipt.transactionHash ||
    receipt.transactionHash.toLowerCase() !== bundle.execution.txHash?.toLowerCase())
    throw Error('First proof lacks matching OrderPlaced and OrderRested receipt events');
  return { planHash: bundle.planHash, proofHash: bundle.hash, txHash: bundle.execution.txHash,
    orderId: FIRST_ORDER_ID, chainId: bundle.chainId, block: receipt.blockNumber,
    gasUsed: receipt.gasUsed, placement: 'VERIFIED', outcomeAtPlacement: 'RESTED_AT_PLACEMENT',
    independentChainReadAtProof: true, proofFile: FIRST_PROOF_FILE,
    orderExpiry: bundle.plan.expiresAt };
}

export async function readFirstProof() {
  return JSON.parse(await readFile(FIRST_PROOF_FILE, 'utf8')) as CanaryProofBundle;
}

export function publicMarket(read: Awaited<ReturnType<typeof inspectTradingAuthorization>>) {
  const book = read.marketIntegrity;
  return { observedAt: read.observedAt, block: read.sampledBlock, chainId: read.chainId,
    market: read.market, mark: /^\d+$/.test(read.markPriceRaw) ? formatUnits(BigInt(read.markPriceRaw), 18) : null,
    book: { status: book.status, reasons: book.reasons, bid: book.bestBid === 'UNKNOWN' ? null : book.bestBid,
      ask: book.bestAsk === 'UNKNOWN' ? null : book.bestAsk, observedAt: book.observedAt,
      block: book.blockNumber, source: book.source },
    bot: { address: read.candidateOperator, gasStt: read.operatorGasStt,
      placeGrant: read.permissions.place.effective.status,
      cancelGrant: read.permissions.cancel.effective.status,
      sampledBlock: read.sampledBlock },
    margin: { unlockedUsdso: read.marginBankUnlocked, status: read.marginSufficient === null ? 'NOT_RUN' :
      read.marginSufficient ? 'SUFFICIENT' : 'INSUFFICIENT', preview: read.marginPreview,
      maximumPlaceable: read.maximumPlaceable },
    risk: { market: read.marketSupported.status, book: book.status, permission: read.permissions.place.effective.status,
      nonce: 'NOT_RUN', gas: read.operatorGasStt === 'UNKNOWN' ? 'UNKNOWN' : 'BALANCE_OBSERVED',
      expiry: 'NOT_RUN', deviation: 'NOT_RUN', simulation: read.simulation.status === 'UNKNOWN' ? 'NOT_RUN' : read.simulation.status,
      reasons: read.planBlockers },
    grid: read.marketGrid,
    mode: 'LIVE_READ_ONLY' as const };
}

export async function readTerminalMarket() {
  const proof = await readFirstProof();
  publicProof(proof);
  const result = await inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
    operator: proof.bot, pool: BTC_POOL });
  const market = publicMarket(result);
  let depth: { status: 'VERIFIED'; bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }> } | { status: 'UNAVAILABLE'; reason: string } =
    { status: 'UNAVAILABLE', reason: 'Trusted top of book required' };
  if (market.book.status === 'TRUSTED') {
    try {
      const readSide = (isBid: boolean) => client.readContract({
        address: BTC_POOL as Hex, abi: depthAbi, functionName: 'getBookLevels',
        args: [isBid, 5n], blockNumber: BigInt(market.block) });
      const [bids, asks] = await Promise.all([readSide(true), readSide(false)]);
      if (bids[0]?.price.toString() !== result.bookTops.bestBidRaw ||
        asks[0]?.price.toString() !== result.bookTops.bestAskRaw)
        throw Error('Pinned depth disagrees with verified best bid/ask');
      const rows = (levels: typeof bids) => levels.map(level => ({
        price: formatUnits(level.price, 18), quantity: formatUnits(level.quantity, 8) }));
      depth = { status: 'VERIFIED', bids: rows(bids), asks: rows(asks) };
    } catch (error) { depth = { status: 'UNAVAILABLE', reason: error instanceof Error ? error.message : 'Depth read failed' }; }
  }
  return { ...market, depth };
}

export type LifecycleEvent = { name: string; block: string; txHash: string; logIndex: number;
  quantityRaw: string | null; source: 'HIDEKI_RPC' | 'VERIFIED_PROOF' };
export function classifyLifecycle(events: LifecycleEvent[], open: boolean | null) {
  const terminal = events.find(e => ['OrderCancelled', 'OrderExpired', 'OrderCancelledSelfMatch',
    'MakerOrderCancelledExceedsPosition', 'OrderCancelledPreFill'].includes(e.name));
  const fills = events.filter(e => e.name === 'OrderFilled');
  const filledRaw = fills.reduce((sum, e) => sum + BigInt(e.quantityRaw ?? '0'), 0n);
  return { state: open === true ? 'OPEN_AT_READ' : open === false ? 'NOT_OPEN_AT_READ' : 'UNKNOWN',
    cause: terminal?.name ?? (open === false && filledRaw > 0n ? 'FILL_OBSERVED_CAUSE_UNCONFIRMED' : 'UNKNOWN'),
    filledRaw: filledRaw.toString() };
}

export async function readFirstOrderAccount() {
  const discovery = await discoverOwnerOnce();
  if (discovery.chainId !== 50383) throw Error('Owner account RPC chain mismatch');
  return { readBlock: discovery.block,
    position: { sizeBtc: formatUnits(BigInt(discovery.position.sizeRaw), 8),
      entryPrice: formatUnits(BigInt(discovery.position.entryPriceRaw), 18), block: discovery.block },
    openOrders: discovery.orders.map(row => ({ id: row.id, side: row.side,
      price: formatUnits(BigInt(row.priceRaw), 18), remaining: formatUnits(BigInt(row.remainingRaw), 8),
      expiryNs: row.expiryNs })) };
}

export async function readFirstOrderHistory() {
  const bundle = await readFirstProof();
  const proof = publicProof(bundle);
  const receiptEvents = decodeKnownLogs(bundle.execution.snapshot!.receipt!).events;
  const firstEvents = receiptEvents.filter(e => ['OrderPlaced', 'OrderRested'].includes(e.eventName) &&
    String(e.args.orderId) === FIRST_ORDER_ID);
  const chainId = await client.getChainId();
  if (chainId !== 50383) throw Error(`Wrong chain ID ${chainId}`);
  const discovery = await discoverOwnerOnce();
  const events: LifecycleEvent[] = firstEvents.map(e => ({ name: e.eventName, block: proof.block,
    txHash: proof.txHash!, logIndex: e.logIndex,
    quantityRaw: e.eventName === 'OrderPlaced' ?
      String((e.args.placedOrder as { fullQuantity?: unknown }).fullQuantity) : null,
    source: 'VERIFIED_PROOF' }));
  // A full-range log scan grew by thousands of RPC calls and blocked every live history request.
  // This endpoint reports the immutable verified placement and the current owner account only.
  // The separately verified later fill is available through Execution Replay.
  const unique = [...new Map(events.map(e => [`${e.txHash}:${e.logIndex}`, e])).values()]
    .sort((a, b) => BigInt(a.block) < BigInt(b.block) ? -1 : BigInt(a.block) > BigInt(b.block) ? 1 : a.logIndex - b.logIndex);
  const open = discovery.chainId === 50383 && BigInt(discovery.block) >= FIRST_BLOCK &&
    discovery.orders.some(row => row.id === FIRST_ORDER_ID);
  return { proof, events: unique, lifecycle: classifyLifecycle(unique, open),
    readBlock: discovery.block, scanThroughBlock: FIRST_BLOCK.toString(),
    scanStatus: 'PARTIAL_VERIFIED_PLACEMENT_ONLY' as const,
    position: { sizeBtc: formatUnits(BigInt(discovery.position.sizeRaw), 8),
      entryPrice: formatUnits(BigInt(discovery.position.entryPriceRaw), 18), block: discovery.block },
    openOrders: discovery.orders.map(row => ({ id: row.id, side: row.side,
      price: formatUnits(BigInt(row.priceRaw), 18), remaining: formatUnits(BigInt(row.remainingRaw), 8),
      expiryNs: row.expiryNs })), mode: 'LIVE_READ_ONLY' as const };
}
