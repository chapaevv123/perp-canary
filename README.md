# Perp Canary

**Product status (M8, 2026-10-28):** Perp Canary is an execution-intelligence and risk-management workspace for on-chain perpetual traders, beginning with dreamDEX on Somnia. The existing guarded terminal now includes a 21-market Radar, browser-local open-tab Alerts, paginated SDK Trade Journal and improved estimated position sizing. [Trader guide](docs/product-feature-guide.md) · [M8 acceptance](docs/m8-product-acceptance.md) · [security review](docs/m8-security-review.md). The repository has not been pushed or publicly deployed for this milestone.

**A guarded dreamDEX perpetual trading terminal on Somnia Hideki testnet (chain 50383).** Perp Canary connects an injected EIP-1193 wallet, discovers verified USDso perp markets, shows fresh pinned order books, and prepares wallet-confirmed PostOnly orders. Canary Trade Guard checks the market, exact account, size, price, margin, pool permission, gas, nonce, expiry, calldata and contract simulation immediately before a wallet prompt.

The product has two distinct account modes:

M7.4 adds a compact account and permission summary, an expandable **Wallet & permissions** section, a position table, and zoom/pan/reset controls for real indexed candles. BUY PostOnly can select the fresh best bid; SELL PostOnly can select the fresh best ask. The crossing shortcut is disabled for each side. **READY FOR REVIEW** means inputs can be checked, while **SAFE** appears only after fresh Guard preflight. See [M7.4 acceptance](docs/m74-ux-acceptance.md) and [final report](docs/m74-final-report.md).

| Mode | Who signs and pays gas | Whose margin, orders and position | Supported writes |
| --- | --- | --- | --- |
| **Delegated Perps** | Connected operator EOA | Linked dreamDEX Wallet 1 smart account | `placeOrderFor`, `cancelOrderFor` when the selected pool grants each selector |
| **Direct Wallet** | Connected EOA | The same EOA | `placeOrder`, exact ERC-20 approval, MarginBank deposit/withdraw, `cancelOrder` |

The known operator `0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42` and Wallet 1 `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f` are never merged. On 2026-10-27 this operator placed a delegated BTC-PERP BUY PostOnly order for Wallet 1, and the exact order was subsequently filled. Successful receipts, matching pool events, the official SDK indexer and the position delta were independently checked. See the [reproducible evidence bundle](docs/evidence/verified-delegated-btc-order.json) and [M6.2 investigation](docs/m62-order-cancellation-investigation.md). Current margin and grants require a fresh read; the earlier [M5.3 readiness sample](docs/m53-delegated-readiness.md) is historical.

## Run locally

Requires Node.js 22.18+, npm, Chromium/Edge/Chrome for browser tests, and read-only network access to the official Hideki RPC, WSS and SDK indexer.

```powershell
cd C:\Users\Win10_Game_OS\Pulse\projects\perp-canary
npm.cmd ci
npm.cmd run serve
```

Open `http://127.0.0.1:8787`. The local server never receives private keys and never signs a user transaction. For a public demo, trusted HTTPS hosting and separate owner approval are still required.

If the server was already running when source files changed, stop it with `Ctrl+C` and run `npm.cmd run serve` again. Both `http://127.0.0.1:8787/` and `http://localhost:8787/` accept normal top-level browser navigation. Cross-origin API requests remain blocked.

## Trading walkthrough

1. Connect MetaMask or another EIP-1193 wallet and check the full address and **Somnia Hideki 50383** in Wallet details.
2. Select **Delegated Perps** to trade the verified Wallet 1 grant, or **Direct Wallet** to use only EOA margin. The account strip displays the correct gas payer, free margin, permission flags, position and open orders.
3. Select an SDK/factory verified market. Wait for a `TRUSTED` order book and fresh mark. The chart reads real fill-derived OHLCV from the official SDK indexer, with an explicit unavailable state when history is absent. The session mark trace uses only observed blocks.
4. Choose BUY/LONG or SELL/SHORT, enter a market tick-aligned limit and lot-aligned quantity, and use **Review wallet order**. The supported order type is PostOnly. SELL may add to a short; it is not reduce-only.
5. Review Canary Trade Guard, owner, operator, exact pool, calldata, nonce, expiry, margin lock and maximum simulated gas cost. **Confirm in wallet** asks the connected wallet for that one transaction. A new preflight must agree with the review.
6. After a transaction, inspect its independent receipt and current open-order list. A resting order is not called filled. If an order remains open, select **Review cancel** and confirm that separate wallet transaction. **Load order history** reads finished orders from the official SDK indexer, which may lag the chain.

Direct Wallet funding is separate: Wallet details shows native STT, transferable wallet USDso, free MarginBank collateral and nonwithdrawable paper credit. The verified Hideki STT funding route is the [official Link a Bot flow](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot); the external EOA can check one-time paper USDso voucher eligibility and review a claim if needed. The Shannon faucet is not a Hideki faucet.

## What is live, and what remains conditional

- **Live reads:** dynamic SDK/factory market discovery (21 tradeable market rows at the 2026-10-27 probe), market status, mark and five-level order book checked against direct RPC at a pinned block; user account balances, permission flags, margin, positions, open orders and optional indexed finished-order history.
- **Unsigned readiness:** guarded PostOnly BUY/SELL and owner-scoped delegated placement, separate reviewed direct funding actions and order cancellation. Actual wallet signing requires an explicit click and wallet confirmation for each write.
- **Canary Intelligence:** transparent Trade Guard, in-tab Market Radar, deterministic Smart Position Sizing, in-tab alerts and a local public-hash trade journal. The stop used for sizing is a reference only. There is no model-backed AI Copilot or background alert service.
- **Verified lifecycle:** one delegated MetaMask placement and its full fill are confirmed on-chain. The position existed before this order; only its 0.00013 BTC increase matches the fill. A live cancellation, direct EOA trade and position close have not been verified. Guaranteed delegated reduce-only close, market/IOC, complete PnL and public hosting are not enabled. The local server must not be advertised as a public trading deployment.

The [capability matrix](docs/M5_TRADING_CAPABILITY_MATRIX.md) and [M5.3 evidence](docs/m53-delegated-readiness.md) separate actual on-chain reads from simulated transactions. The historical bot proof is documented in [verified on-chain evidence](docs/verified-onchain-evidence.md): transaction `0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121` at block 34465778 emitted `OrderPlaced` and `OrderRested`. The original bounded scan left its later cause unknown; a later 2026-10-27 live terminal scan reported `OrderExpired`.

## Architecture and security

Browser UI → local read-only/unsigned-plan API → official `@somnia-chain/markets-sdk@0.32.1` plus verified Hideki contracts. Only the injected wallet's `eth_sendTransaction` can send a user transaction, after a visible review. Server endpoints neither accept secrets nor broadcast. The historic bot CLI and encrypted keystore remain isolated from browser trading. PostOnly plans have a five-minute expiry, 100 USDso notional cap, 1% mark-deviation cap, 0.1 STT simulated gas cap, fresh book and contract simulation. Grants can be revoked at any time and are re-read at each delegated preflight.

## Checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
npm.cmd run verify
node --experimental-strip-types scripts/m53-delegated-readiness.ts
```

`test:ui` uses Chromium and mocked wallet transactions by default. Set `CANARY_UI_LIVE=1` to add a **read-only** live Hideki browser smoke; it still does not sign. The readiness script only reads and estimates gas. Test fixtures and simulations are separate from the independently verified historical MetaMask trade.

Set `CANARY_UI_LIVE_RADAR=1` for the separate read-only 21-market Chromium Radar and SDK Journal smoke. This is a resource-bounded scan, but it makes 21 real snapshot reads and requires outbound HTTPS and WebSocket. [Fixture screenshots](docs/screenshots/m8-market-radar-fixture.png) are separate from [live Radar](docs/screenshots/m8-market-radar-live.png) and [live Journal](docs/screenshots/m8-trade-journal-live.png). Open-tab alerts do not notify after the browser closes; fees, 24h metrics and realized PnL remain unavailable without verified source coverage.

## Demo and submission

- [Judge walkthrough and English submission draft](docs/m6-submission-pack.md)
- [M7 product acceptance](docs/m7-product-acceptance.md), [final report](docs/m7-final-product-report.md), [judge walkthrough](docs/m7-judge-walkthrough.md) and [public deployment runbook](docs/m7-deployment.md)
- [M7 live terminal](docs/screenshots/m7-terminal-live.png), [mocked terminal](docs/screenshots/m7-terminal-mocked.png) and [verified execution replay](docs/screenshots/m7-replay-verified.png)
- [Local demo walkthrough](docs/demo-walkthrough.md)
- [Live terminal screenshot](docs/screenshots/live-terminal.png) and [mocked delegated review](docs/screenshots/delegated-review-mocked.png)
- [M5.3 delegated readiness](docs/m53-delegated-readiness.md)
- [M6.1 live preflight mismatch diagnosis and fix](docs/m61-preflight-fix.md)
- [M6.2 exact order fill and cancellation investigation](docs/m62-order-cancellation-investigation.md)
- [M5.2 wallet and funding audit](docs/m52-wallet-funding.md)
- [Security model](docs/security-model.md)
- [Historical bot proof](docs/verified-onchain-evidence.md)

No push, deployment or submission is performed by this repository workflow.

For owner-approved publication preparation, see the [deployment plan](docs/m8-deployment-plan.md), [submission draft](docs/submission/dorahacks-submission.md) and [two-minute demo](docs/submission/demo-script.md). `Dockerfile`, `fly.example.toml` and `.env.example` are templates only.
