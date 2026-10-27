import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { RPC } from '../src/rpc-health.ts';
import { BTC_POOL } from '../src/trade-forensics.ts';
import { BOOK_SOURCE, validateMarketSnapshot } from '../src/market-integrity.ts';

const client = createPublicClient({ chain: hidekiTestnet,
  transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
const abi = parseAbi(['function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])']);
const normalized = (raw: string | null) => raw === null ? 'UNKNOWN' : formatUnits(BigInt(raw), 18);
try {
  const market = (await sdk.client.listPerpMarkets()).find(row =>
    row.poolAddress.toLowerCase() === BTC_POOL.toLowerCase());
  if (!market) throw Error('BTC-PERP pool missing from official SDK market rows');
  for (let i = 0; i < 3; i++) {
    const sampledAt = new Date().toISOString();
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber });
    const [sdkBook, bids, asks] = await Promise.all([
      sdk.client.getBookTopsOnchain([{ id: BTC_POOL, poolAddress: BTC_POOL }], { blockNumber }),
      client.readContract({ address: BTC_POOL, abi, functionName: 'getBookLevels',
        args: [true, 1n], blockNumber }),
      client.readContract({ address: BTC_POOL, abi, functionName: 'getBookLevels',
        args: [false, 1n], blockNumber }),
    ]);
    const postReadBlock = await client.getBlock({ blockNumber });
    const sdkTop = sdkBook.tops[BTC_POOL.toLowerCase()];
    const directBid = bids[0]?.price.toString() ?? null;
    const directAsk = asks[0]?.price.toString() ?? null;
    const sdkBid = sdkTop?.bestBid ?? null;
    const sdkAsk = sdkTop?.bestAsk ?? null;
    const observedAt = new Date().toISOString();
    const integrity = validateMarketSnapshot({ market: `${market.baseSymbol}-PERP`,
      pool: BTC_POOL, source: BOOK_SOURCE, rpcUrl: RPC,
      blockNumber: sdkBook.blockNumber.toString(), blockHash: block.hash,
      postReadBlockHash: postReadBlock.hash,
      blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(), observedAt,
      quoteDecimals: market.quoteDecimals, tickSizeRaw: market.tickSize.toString(),
      bestBidRaw: sdkBid ?? 'UNKNOWN', bestAskRaw: sdkAsk ?? 'UNKNOWN',
      directBestBidRaw: directBid ?? 'UNKNOWN', directBestAskRaw: directAsk ?? 'UNKNOWN' },
    { market: `${market.baseSymbol}-PERP`, pool: BTC_POOL, sampledBlock: blockNumber.toString() });
    console.log(JSON.stringify({ sampledAt, chainId: await client.getChainId(), market: 'BTC-PERP',
      pool: BTC_POOL, source: { sdk: 'Markets SDK 0.32.1 getBookTopsOnchain via configured WS RPC',
        direct: RPC }, blockNumber: blockNumber.toString(), blockHash: block.hash,
      blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      sdkBlockNumber: sdkBook.blockNumber.toString(), raw: { sdkBid, sdkAsk, directBid, directAsk },
      normalized: { sdkBid: normalized(sdkBid), sdkAsk: normalized(sdkAsk),
        directBid: normalized(directBid), directAsk: normalized(directAsk) },
      sdkDirectAgree: sdkBid === directBid && sdkAsk === directAsk, integrity }, null, 2));
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { sdk.close(); }
