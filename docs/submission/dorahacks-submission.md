# Perp Canary — dreamDEX Perps Builder Bounty

**Tagline:** Perp Canary is an execution-intelligence and risk-management workspace for on-chain perpetual traders, beginning with dreamDEX on Somnia.

## Problem and product

On-chain perp traders need to discover usable markets, understand quote quality and account risk, and distinguish an order intent from an actual fill. Perp Canary joins verified live market data, an explainable safety gate, explicit wallet-confirmed PostOnly execution, open-tab monitoring and evidence-based trade review in one workflow.

## Working today

- Discovers 21 verified Hideki PERP markets from the official SDK and factory checks. Live read-only Chromium scans on 2026-10-28 obtained all 21 snapshots in one run; a later run degraded to 15 snapshots and 10 current scores while partial source failures remained visible. Scores describe operational market quality, not predicted profit.
- Shows real fill-derived OHLCV, pinned bid/ask and depth, quote freshness, wallet account position and selected-market permission state. Unsupported 24h metrics are unavailable.
- Offers PostOnly BUY/SELL planning, maker-side bid/ask shortcuts, decimal-safe position sizing, deterministic Canary Guard, exact preflight/simulation and explicit wallet confirmation. No autonomous trades.
- Offers browser-local alerts for market price/spread/funding thresholds and feed health, active only while the tab is open.
- Reads official SDK paginated finished-order history. The verified historical delegated BTC order has matching placement/fill receipts and events: order `14978756187852164141712`, placement `0xb542d3a603b33a598f8dab8d2e4f38c8b7ee163bfbd169dd32acc9429d35d28f`, fill `0x1b7e19bb1afbf14ed21e74da7cf667ccb17c40ec310698293dbd6e4c343f65d4`. Replay supports its maker role and fill price. Only its `0.00013 BTC` increment is attributed to Perp Canary. The Wallet 1 position existed earlier.

## Evidence and limits

Read-only live validation covered RPC, WebSocket, indexer, pool, 21-market Radar and Wallet 1 journal. M8 sent no transaction or signature. One earlier delegated BTC placement and fill are independently verified in the repository's evidence bundle. We do not claim a live cancellation, guaranteed reduce-only close, complete fee/PnL analytics, persistent closed-browser alerts or a deployed public app.

## Technical architecture

Node.js 22 service and browser UI use `@somnia-chain/markets-sdk@0.32.1`, Hideki chain identity 50383, direct same-block RPC book checks and official indexer reads. The server returns public data and unsigned plans; only an injected EIP-1193 wallet can submit after the user reviews a fresh Canary Guard plan. Exact HTTPS Host/Origin allowlists protect public mode. Local browser storage keeps alert rules; no user alert database or signing key exists on the server.

## Links to fill after approval

- GitHub: https://github.com/chapaevv123/perp-canary — public `main` verified at `061bd186043742bda60ab7aa5a8b8f1154f8355c` on 2026-10-28.
- Temporary public preview: https://bodies-radio-irrigation-assume.trycloudflare.com — verified read-only, changes or disappears when the local Quick Tunnel stops; **do not use as a durable submission URL**.
- Durable demo: `[VERIFIED PRODUCTION HTTPS URL PENDING]`
- Product post: `[PUBLIC POST URL PENDING]`
- Demo video: `[VIDEO URL PENDING]`
- Evidence: `docs/evidence/verified-delegated-btc-order.json` in repository after approved push.

## Submission gate

The [DoraHacks bounty page](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) returned an access error to automated retrieval on 2026-10-28. The [DoraHacks-organized event listing](https://www.eventbrite.com/e/dreamdex-perps-builder-bounty-tickets-2003605109819) says registration is open but only whitelisted emails can submit; other builders should contact dreamDEX Discord or SomniaHacks Telegram with their DoraHacks email. The listing ends on November 2, but this is **not proof of the Build submission deadline**. A third-party summary says November 1, 23:59 UTC; treat that as unverified until the owner sees the actual DoraHacks form. Confirm whitelist, exact deadline, required fields and eligibility before submitting. No submission was made.
