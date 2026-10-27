import { createPublicClient, http, parseAbi, toFunctionSelector } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { RPC } from '../src/rpc-health.ts';
import { BTC_POOL, HIDEKI_MARGIN_BANK } from '../src/trade-forensics.ts';

const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
const place = parseAbi(['function placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)']);
const cancel = parseAbi(['function cancelOrder(uint128)']);
const poolReads = parseAbi([
  'function getOrderBookParameters() view returns (uint256 tickSize,uint256 minQuantity,uint256 lotSize)',
  'function marginBank() view returns (address)',
]);
const [chainId, block, poolCode, bankCode, grid, bank] = await Promise.all([
  client.getChainId(), client.getBlockNumber(), client.getBytecode({ address: BTC_POOL }),
  client.getBytecode({ address: HIDEKI_MARGIN_BANK }),
  client.readContract({ address: BTC_POOL, abi: poolReads, functionName: 'getOrderBookParameters' }),
  client.readContract({ address: BTC_POOL, abi: poolReads, functionName: 'marginBank' }),
]);
console.log(JSON.stringify({ chainId, block: block.toString(), pool: BTC_POOL,
  poolCodeBytes: poolCode ? (poolCode.length - 2) / 2 : 0,
  marginBank: bank, expectedMarginBank: HIDEKI_MARGIN_BANK,
  bankCodeBytes: bankCode ? (bankCode.length - 2) / 2 : 0,
  grid: grid.map(value => value.toString()),
  selectors: { placeOrder: toFunctionSelector(place[0]!), cancelOrder: toFunctionSelector(cancel[0]!) } }, null, 2));
