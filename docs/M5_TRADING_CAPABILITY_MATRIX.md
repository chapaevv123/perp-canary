# M5.0 trading capability matrix

## M5.1 continuation (2026-10-27)

The table below records the M5.0 baseline. M5.1 adds dynamic SDK `listPerpMarkets()` plus factory status discovery. A selected market's pool `marginBank()`, `getOrderBookParameters()`, pinned top of book and direct contract levels must agree before the quote is TRUSTED. A read-only official SDK probe returned **21 factory-tradeable markets** on 2026-10-27: 1000PEPE, ADA, AVAX, BNB, BTC, DOGE, ETH, HYPE, LINK, LIT, NEAR, PUMP, SOL, SUI, TAO, VVV, WLD, XLM, XRP, ZEC and ZRO, all quoted in USDso. This is a time-specific discovery result, not proof that every market has a liquid trusted book or accepts every wallet's order.

M5.1 implements unsigned direct-wallet preparation for those selected markets and separate reviewed `approve(exactAmount)`, MarginBank `deposit`/`withdraw`, and pool `cancelOrder` calls. Each is simulated and requires an explicit wallet send. The browser journal stores public hashes locally and distinguishes wallet submission, receipt confirmation and current open-order observation. Radar uses only fresh trusted top-five depth and mark samples; sizing uses verified precision and an entered stop *reference*, not an installed stop. These are implemented and covered by unit or mocked Chromium tests. **No M5.1 user-wallet transaction or margin lifecycle has been independently verified on-chain.** The owner bot proof is separate.

Remaining product gaps: user-wallet live transaction validation, guaranteed reduce-only/close, market/IOC execution controls, complete historical fill and PnL accounting, independently verified alerts outside an open tab, and an actual model-backed AI Copilot. The present deterministic radar and Guard must not be presented as AI. Browser trading still runs on loopback and is not a public deployment.

Status: **browser trading foundation, not a verified public trading product**. No M5 user trade was signed or broadcast. A successful mocked receipt proves only UI behavior. The M4 owner bot proof remains separate and unchanged.

## Provenance and deployment check

Official sources: [Perps testnet](https://app.testnet.dreamdex.io/docs/developers/perps-testnet), [contract functions](https://app.testnet.dreamdex.io/docs/developers/contracts/functions), [contract types](https://app.testnet.dreamdex.io/docs/developers/contracts/types), [perp orders](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders), [link a bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot), [wallet API](https://app.testnet.dreamdex.io/docs/developers/http-api/wallets). The generic contract pages also cover spot; they do not independently establish that every function is supported on this perp pool.

Installed `@somnia-chain/markets-sdk@0.32.1` and `viem@2.57.7` are used. A **read-only** Hideki RPC probe at block 34620366 confirmed chain **50383**, deployed BTC-PERP pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, pool `marginBank()` `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, tick **0.1 USDso**, lot **0.00001 BTC**, minimum **0.00013 BTC**. The installed PerpPool ABI has direct `placeOrder` selector `0x4e978373` and `cancelOrder` selector `0xdbc91396`. A selector or deployed bytecode alone does **not** prove an unfunded EOA can successfully trade. Run the read-only probe with `node --experimental-strip-types scripts/m5-capability-probe.ts`.

`Wallet1` smart accounts and linked bots are distinct from an injected EOA. EOA → smart-wallet mapping is not assumed. The direct browser path always uses the connected EOA as the MarginBank account, and never accesses the owner bot keystore.

| Operation | Official source / method and required arguments | Wallet permission / order type | Preconditions and verification | Implementation / coverage |
|---|---|---|---|---|
| Wallet connection | EIP-1193 `eth_requestAccounts` | User approves account exposure | Injected provider, address format; standard wallet API, wallet compatibility varies | Implemented; Chromium mock and missing-wallet path |
| Network switch/add | EIP-1193 `wallet_switchEthereumChain`, `wallet_addEthereumChain` | Explicit wallet approval | Exact chain 50383 checked again before send | Implemented; Chromium mock wrong-chain and switch |
| Account balances | ERC-20 `balanceOf(account)`, RPC `getBalance`, SDK `getMarginAccount` | Read-only | Registry collateral address and verified bank | Implemented as real reads; SDK/RPC errors shown, no invented balance |
| Market discovery | SDK `listPerpMarkets()` | Read-only | Registry BTC pool, bank, 8/18 decimals must match | BTC-PERP verified only; other markets disabled |
| Market quotes | SDK + pinned on-chain book + direct RPC integrity; `readTerminalMarket()` | Read-only | TRUSTED and ≤30s at review | Implemented; existing live read and Chromium stale tests |
| Limit BUY | PerpPool `placeOrder(true,0,priceRaw,qtyRaw,expiryNs,3,0,zero,0)` | `eth_sendTransaction` after review; PostOnly | Exact chain/pool/bank, grid, max size, margin, gas, simulation, fresh book, noncrossing, 100 USDso/1%/300s/0.1 STT | Unsigned prepare + explicit wallet send + receipt UI implemented; **real EOA submission unverified**; pure guard and mocked browser coverage |
| Limit SELL | Same `placeOrder(false,...)`; [orders](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders) | Same; PostOnly | Can increase short; never presented as reduce-only | Same implementation, amber warning; **real EOA submission unverified** |
| Market orders | SDK mentions taker methods; generic contract docs are insufficient for direct perp support | Wallet transaction | Slippage, fill and margin safety not established | Disabled / unverified |
| PostOnly | Installed PerpPool ABI enum `orderType=3`; observed first owner order | Wallet transaction | Noncrossing top and contract simulation | Implemented in direct prepare; EOA outcome unverified |
| IOC | Generic order type documentation / SDK | Wallet transaction | Direct perp semantics and safe slippage not established here | Disabled / unverified |
| Order cancellation | PerpPool `cancelOrder(uint128 orderId)` selector deployed in ABI | Wallet transaction | Live ownership, status, fresh simulation, explicit review needed | **Not enabled**; no unverified cancel button |
| Position reading | SDK `getPerpPosition({marginBank,pool,account})` | Read-only | Exact connected account and registry | Implemented; account panel and Chromium mock |
| Position reduction | SELL/BUY may change size, but no verified reduce-only direct operation | Wallet transaction | Current size, race handling, reduction guarantee | Disabled / unverified |
| Position closing | SDK/delegated close methods need account and margin verification | Wallet transaction | Reliable reduce-only and close semantics | Disabled / unverified |
| Margin | SDK `getMarginAccount`, `getMaxPerpOrderSize`; MarginBank write APIs need allowance/deposit review | Read-only for current UI | No unlimited approvals, funding or deposit transaction in M5 | Read implemented; deposit/withdraw disabled; **funded EOA prerequisite unresolved** |
| Leverage | SDK margin/position reads | Read-only | Reliable account equity, liquidation model and precise inputs | No leverage control or fabricated liquidation estimate |
| Order status | SDK `getOpenOrdersOnchain`, receipt `OrderPlaced` | Read-only | Open state can change; receipt placement is not fill | Open orders read; no complete historical index; receipt status distinct |
| Transaction receipts | RPC `getTransaction`, `getTransactionReceipt`, SDK `orderBookEventsAbi` | Read-only | Must match account, pool, selector, event owner | Implemented; mocked pending/placed UI; **no M5 real receipt** |

## Canary Trade Guard

The direct route checks account/chain/contracts, snapshot age, price/quantity decimals and grid, 100 USDso cap, mark deviation ≤1%, PostOnly crossing, SDK maximum placeable size, STT balance, `eth_estimateGas` simulation and 0.1 STT gas budget. It rechecks immediately before the wallet request and requires identical calldata. RED prevents submission. AMBER flags known caution (especially SELL possibly adding a short). UNKNOWN is shown until a fresh review. Browser send is never automatic or retried.

## Remaining blockers for public trading

1. Validate a funded **user EOA** against the actual deployed pool and MarginBank with an owner-authorized, small test transaction. Current read-only probe and mocked receipt cannot establish this outcome.
2. Implement and independently verify deposit/allowance or smart-wallet integration so a new user can fund trading margin without using the owner bot wallet. Never grant unlimited allowance by default.
3. Verify cancel, reduce-only/close, order history, reliable PnL and liquidation inputs on-chain before enabling them.
4. Test real wallet providers and external RPC/indexer failure paths. Serve over a trusted HTTPS origin for public deployment; local development remains loopback only.
