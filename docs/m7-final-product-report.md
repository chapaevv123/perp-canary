# M7 final product report — 2026-10-28

## Recovery

The interrupted session left no M7 commit after `d342446`. It left implementations of indexed candles/trades, pinned position intelligence, Guard V2 explanation, verified execution replay, public server controls, deployment scaffolding, Chromium tests and screenshots. The untracked `design/` reference was preserved. The old acceptance ledger was stale; code and test results determined the recovered state.

## Completion after resume

Fixed a TypeScript assertion against the HTTP header union type and browser fixtures that produced 400 console errors after position intelligence was added. Corrected the market-switching chart title assertion. Public navigation no longer points to disabled owner diagnostics. The release manifest now describes the gated HTTPS mode. Rebuilt the package, completed live read-only Chromium smoke, and added a live screenshot and judge walkthrough.

## Product state

The responsive terminal has verified market discovery, pinned book, real fill-derived OHLCV, recent indexed fills, direct and delegated modes, wallet-confirmed PostOnly review, balances, positions, open orders and finished order history. Canary Trade Guard V2 explains eight check groups and returns safe-to-review, caution or blocked guidance. A fresh server-side preflight must still match before the wallet prompt. The position snapshot supplies SDK-supported entry, mark, unrealized PnL, funding and margin plus a price-only scenario. Unsupported realized PnL and liquidation values stay unavailable.

Execution replay is limited to verified historical order `14978756187852164141712`. It links placement and fill receipts, decoded events, indexer full-fill status and the 0.00013 BTC position increment. No historic preflight is invented. Mocked browser wallet flows are labeled separately from this actual execution.

Public mode has exact HTTPS Origin/Host checks, route allowlist, POST Origin check, cross-site rejection, rate limiting, request size limit and security headers. It is prepared for a loopback Node process behind Caddy. Actual domain/VPS deployment and public smoke remain pending owner approval and infrastructure.

## Verification

| Check | Result |
| --- | --- |
| `npm.cmd test` | 176 passed, 0 failed |
| `npm.cmd run lint` | passed |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed; `dist/` produced |
| Chromium `CANARY_UI_LIVE=1 npm.cmd run test:ui` | 12 passed, 0 failed, 0 skipped |
| Live SDK market history | BTC 5m: 120 real candles; recent fills: 20 |
| Live Wallet 1 position | block 35178231; LONG 0.05429 BTC; entry 80045.802320869405046969; mark 80776.047770380965; unrealized PnL 39.64502545398258985 USDso at that snapshot |

Chromium used actual browser rendering and live RPC market/book/history; wallet signing scenarios were mocked and did not send transactions. [Live screenshot](screenshots/m7-terminal-live.png), [mocked screenshot](screenshots/m7-terminal-mocked.png), [replay screenshot](screenshots/m7-replay-verified.png).

## Launch and submission limits

Guaranteed delegated reduce-only closure is not established. A live cancellation, direct-wallet placement and new M7 trade were not performed. Public production behavior still needs real HTTPS host smoke and RPC/indexer capacity observation. Push, deployment and DoraHacks submission need explicit owner approval. The DoraHacks portal detail page returned 405 to automated retrieval; the organizer [Eventbrite listing](https://www.eventbrite.com/e/dreamdex-perps-builder-bounty-tickets-2003605109819) ends Nov 2 while third-party summaries say Nov 1. Plan for Nov 1 and confirm the exact portal timestamp manually. The organizer lists a whitelisted DoraHacks email as necessary to submit.

## Local release

See [deployment runbook](m7-deployment.md) and [judge walkthrough](m7-judge-walkthrough.md). Local M7 commit hash is recorded in Git after commit creation; no remote push is part of this report.
