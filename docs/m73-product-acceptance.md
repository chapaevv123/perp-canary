# M7.2 + M7.3 product acceptance — 2026-10-28

Baseline: local M7.1 commit `8278be40d94615a3700797cfc09b8f3a5bd91c3c`. The previous M7 implementation, verified delegated BTC evidence and untracked `design/` directory were preserved. This checkpoint records the implementation state before the M7.3 local commit. No signing, chain write, push or deployment occurred.

## Connectivity and market acceptance

| Criterion | Result | Evidence and boundary |
| --- | --- | --- |
| Browser homepage | PASS | `GET /` returned HTTP 200 `text/html` on `127.0.0.1:8787`; Chromium loaded terminal. M7.1 local Host/Origin policy remains. |
| HTTP RPC | PASS | Hideki chain 50383, current block; `/api/v1/health/sources` reported `HEALTHY`. |
| WebSocket RPC | PASS | Native WS `eth_chainId` returned 50383; SDK genesis verification remained enabled. |
| GraphQL indexer | PASS | Hideki `chain_metadata` returned chain 50383 and processed block; no fixture fallback. |
| BTC pool and feed | PASS | SDK and direct same-block book match; live mark, five levels per side, 120 real 5m fill-derived candles in Chromium. |
| ETH pool and feed | PASS | Independent ETH pool, precision and book; live mark, five levels per side, 120 real 5m candles in Chromium. |
| Market discovery | PASS | 21 active PERP markets from SDK registry and factory status. Spot markets are excluded. No hardcoded count. |
| Account mode | PASS | Operator EOA and Wallet 1 owner separated; per-pool grants read for selected market. Live Wallet 1 BTC position read from owner account. |
| Failure isolation | PASS with limit | Health probes report RPC, WS, indexer and pool separately. A previously verified registry is retained read-only if indexer later fails; trading risk blocks until fresh registry succeeds. Cold-start indexer outage cannot discover markets. |
| Reconnect | PASS | Bounded 8–45 s server reads, HTTP retry where supported, 30 s health polling and 3 bounded automatic market retries (3, 8, 20 s). Browser market switch ignores late previous-market responses. |
| Public security | PASS locally | Exact HTTPS Host/Origin, route allowlist, no wildcard CORS, rate limiting and sanitization retained. Real public domain smoke still pending deployment approval. |

First-party reference: [dreamDEX perps developer documentation](https://app.testnet.dreamdex.io/docs/developers/perps-testnet). Verified endpoints: `https://api.hideki2.infra.testnet.somnia.network`, `wss://api.hideki2.infra.testnet.somnia.network/ws`, `https://hideki-dev.smk.somnia.host/v1/graphql`; SDK `@somnia-chain/markets-sdk@0.32.1`.

### Verified PERP markets

`ZRO-PERP`, `LIT-PERP`, `VVV-PERP`, `1000PEPE-PERP`, `PUMP-PERP`, `ZEC-PERP`, `TAO-PERP`, `WLD-PERP`, `NEAR-PERP`, `XLM-PERP`, `AVAX-PERP`, `LINK-PERP`, `SUI-PERP`, `ADA-PERP`, `BNB-PERP`, `DOGE-PERP`, `XRP-PERP`, `HYPE-PERP`, `SOL-PERP`, `ETH-PERP`, `BTC-PERP`.

At the captured block all 21 factory pools reported `TRADEABLE`, meaning the market pool is active. **A wallet is never marked trade-eligible from this alone.** Its selected account, margin, gas and market-specific grant are checked during fresh order review. Every listed perp is browsable; the supported wallet action is PostOnly limit, subject to guard and explicit wallet confirmation.

## Product acceptance

| Area | Result | Limit |
| --- | --- | --- |
| Desktop terminal | PASS | Chart, book and ticket share the top trading row at wide desktop sizes; six account tabs below. |
| Tablet/mobile | PASS | Responsive 320–2560 px Chromium checks; 1280 px uses two-column top; 800 px and narrower stack top panels. |
| Market selector | PASS | Search, All Perps, Favorites, Recently viewed, keyboard navigation, Escape, focus return, local public-symbol storage, active-market indication. Unsupported 24h change/volume explicitly unavailable. |
| Chart | PASS | Real indexed OHLCV, price/time axes, volume, supported timeframe selector, hover/crosshair readout, current mark indicator, responsive canvas, error/empty state. Indexed fills can lag live mark. |
| Order book | PASS | Same-block verified SDK/direct bid/ask with 5 levels each, spread, source, timestamp/block; stale/untrusted state disables dependent actions. |
| Trade ticket | PASS for supported path | Buy/Long and Sell/Short PostOnly, quantity/price, bid/ask, offsets, notional and exact-grid validation, fresh preflight/simulation and wallet review. Review alone never sends. No fake market/stop/reduce-only order. |
| Canary Guard V2 | PASS for supported path | SAFE/CAUTION/BLOCKED/UNAVAILABLE, concise decision, expandable checks and next action. Fresh recheck before wallet request. Essential missing evidence cannot produce SAFE. |
| Position Intelligence | PASS with honest limits | Live pinned owner position, entry, mark, unrealized PnL, funding, free margin, liquidation reference where SDK supports it, price-only scenario. Realized PnL unavailable from snapshot. Display values rounded for readability; source values remain untouched. |
| Execution Replay | PASS | Verified historical BTC order `14978756187852164141712` placement and fill transactions, decoded events, status and provenance. Only incremental `0.00013 BTC` belongs to this execution. |
| Guaranteed delegated close | BLOCKED by protocol evidence | No verified safe owner-scoped reduce-only path. No guaranteed close claim or automatic closure. |

## Visible control inventory

| Control | Function and enabled state | Acceptance evidence |
| --- | --- | --- |
| Market selector | Opens accessible dialog; shows only SDK-verified PERPS; selection resets market-scoped data | Chromium live and mocked rapid switch |
| Search / All Perps | Filters verified symbols; empty search gives explicit result | Chromium selector regression |
| Favorites / Recently viewed | Persists public symbols locally; does not store wallet data | Chromium selector regression |
| Market rows / Escape / arrows | Selects active market; closes and returns focus; keyboard moves options | Chromium selector regression |
| Timeframe | Requests real indexed candles for selected interval; unavailable history is labeled | Chromium chart tests and live 5m reads |
| Refresh live data | Re-reads selected market and source health; shows loading; bounded retry on failure | Chromium tests, live browser |
| Buy/Long / Sell/Short | Sets side and price helper availability; Sell is **not** guaranteed reduce-only | Chromium ticket tests |
| Order type | PostOnly is the only verified supported choice; other types are not offered | Chromium disabled-state test |
| Quantity / price | Validates decimal, lot, tick, minimum, notional, crossing and freshness | Chromium ticket and unit tests |
| Best Bid / Best Ask | Fills appropriate maker price only with trusted book and compatible side | Chromium ticket tests |
| Price offsets | Uses correct side's trusted top; disabled on stale/untrusted book | Chromium ticket tests |
| Position sizing | Explicit price-only reference; use quantity only when result valid | Existing UI/unit logic tests |
| Review wallet order | Fresh account/grant/margin/gas/simulation/Guard; does not send | Mocked wallet Chromium; no live submission |
| Confirm in wallet / edit | Rechecks immediately and asks wallet only after explicit click; edit invalidates | Mocked wallet Chromium; no live signature |
| Direct / Delegated account mode | Shows distinct EOA and Wallet 1 margin/grants; refreshes market-specific account | Mocked tests; live read-only Wallet 1 BTC |
| Connect / switch / disconnect | EIP-1193 account/network actions with clear state | Mocked wallet Chromium; read-only injected wallet in live acceptance |
| Open Orders / Review cancel | Shows selected account/market orders; cancel opens separate review in Balances | Mocked wallet Chromium |
| Order History / Load | Reads indexed finished orders; labels possible lag | Mocked Chromium; not proof of live history availability |
| Trade History | Shows browser-submitted public transaction references only | Chromium layout and receipt mock |
| Balances / Margin actions | Approve exact amount, deposit, withdraw, cancel each have review and confirmation | Mocked wallet Chromium; no live action |
| Refresh position / scenario slider | Re-reads pinned SDK metrics; scenario only enabled with real inputs | Live Wallet 1 BTC, unit tests |
| Execution Replay / Verified trade | Opens immutable historical placement/fill evidence | Chromium replay test |
| Connection details | Expands independent RPC/WS/indexer/pool results | Live and degraded Chromium |
| Historical owner diagnostics | Explicit expandable local-only archive; hidden in public mode | Existing server/browser security tests |

## Final verification checkpoint

- `npm.cmd test`: 178 passed, 0 failed.
- `npm.cmd run lint`: passed after browser-script global declaration.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run test:ui`: 14 passed, 0 failed, 1 skipped (optional live smoke is run separately against the real server).
- `npm.cmd run build`: passed; `dist/` produced.
- Real Chromium, no market-response mocks: BTC and ETH live book/mark plus 120 candles each; source chips all live; Wallet 1 BTC `LONG 0.05429` at a pinned block. The browser's injected EIP-1193 provider supplied only `eth_accounts` and `eth_chainId`; every signing or sending method threw.
- Screenshots: [live terminal](screenshots/m73-terminal-live.png), [market selector](screenshots/m73-market-selector.png), [position intelligence](screenshots/m73-position-intelligence.png).

## Safe resume point

Inspect `git status --short` and this checklist before further work. Preserve `design/`, the M7.1 security fix, and `docs/evidence/verified-delegated-btc-order.json`. No new chain transaction, signature, Git push or public deployment is authorized by this acceptance run.
