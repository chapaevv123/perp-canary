# Perp Canary

Perp Canary is a local BTC-PERP terminal and owner-confirmed execution workflow for dreamDEX Perps on Somnia Hideki (chain ID **50383**). It pairs live market and wallet reads with a verifiable proof of the first real on-chain order. The browser is read-only: it does not sign, send, cancel, or close orders.

## Verified first order

The first owner-approved PostOnly BUY was mined in block **34465778**. The receipt succeeded and the pool emitted `OrderPlaced` and `OrderRested` for order **14978756187852164026332**. Transaction: `0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121`. The independent [proof bundle](canary-proofs/canary-proof-1793098877887-4230656d134c.json) has SHA-256 `4230656d134ca6644edfbbcd5ec97468e8381e672c78bdb5ddd5730518d20e92`.

Later on-chain order reads show `NOT_OPEN_AT_READ`, while the wallet position was **0.05416 BTC** at the latest read. An indexed event scan found no fill, cancellation, or expiry event for this order through the scanned block. Its disappearance cause remains **UNKNOWN**. See [verified evidence and lifecycle](docs/verified-onchain-evidence.md).

## Getting started on Windows

Requires Node.js 22.18+, npm, Windows PowerShell, and access to the configured Hideki RPC/WSS and SDK indexer. Viewing the site needs no wallet password.

```powershell
cd C:\Users\Win10_Game_OS\Pulse\projects\perp-canary
npm.cmd ci
npm.cmd run serve
```

Open **http://127.0.0.1:8787**. The terminal is the home page. The earlier research and diagnostics UI remains at `/legacy`.

The chart begins when the page opens and contains only actual trusted mark quotes collected during that session; it draws a line after the second distinct block. Empty, stale, or failed reads remain visibly marked. The right-hand trade panel is a **local visual preview**: its quantity and price fields do not prepare or submit a plan. When the values satisfy the visible tick, lot, PostOnly, deviation and notional checks, its copy button produces the exact `npm.cmd run canary-prepare -- BUY <price> <quantity>` command. The CLI performs a fresh independent preflight and can still block it. BUY PostOnly is the verified owner path; unsupported SELL, IOC and Best Ask for a PostOnly BUY are disabled.

To prepare a new plan, the owner runs `npm.cmd run canary-first-proof` in a local terminal, selects a quoted candidate, reviews the printed plan and its 300-second expiry, then separately runs the exact `bot-execute` command if desired. The CLI asks for `EXECUTE <full plan hash>`, unlocks the local keystore through masked input, and repeats preflight before any signature. No action is automatic. **The first plan has expired and cannot be reused.**

## Confirmed capabilities and limits

- Live Hideki mark, pinned SDK + direct RPC best bid/ask, up to five verified contract book levels per side, freshness, block, delegated place grant, wallet position, and open orders.
- Read-only on-chain event scan for the first order with block and transaction provenance. Missing lifecycle evidence remains `UNKNOWN`.
- Copy controls for proof and transaction hashes, plan hash, and, only for an unexpired saved plan, the owner CLI command and exact confirmation.
- Local SHA-256 proof bundle, verified receipt, and evidence timeline. The historical research UI and CLI remain available.
- Owner CLI PostOnly workflow with 300-second plan expiry, maximum 100 USDso notional, maximum 0.1 STT gas, maximum 1% mark deviation, TRUSTED market snapshot, margin, grants, nonce, simulation, idempotency, and immediate final preflight.

The browser's risk panel uses `NOT_RUN` for checks that have not been performed for a specific plan. A displayed quote never means an order is approved. SELL, IOC, automatic cancellation, and delegated position close are not claimed as verified features.

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [Verified on-chain evidence](docs/verified-onchain-evidence.md)
- [Demo walkthrough](docs/demo-walkthrough.md)
- [Hackathon submission draft](docs/hackathon-submission-draft.md)
- [Historical implementation notes](docs/m4-first-proof.md)

## Development checks

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run verify
git diff --check
```

`verify` checks local evidence chains and proof artifacts. These commands do not sign or send a transaction.

`test:ui` launches installed Chromium, Edge or Chrome against the local server. It checks controls, clipboard, chart rendering, error and stale states, `/legacy`, and layout at 2560×1440, 1920×1080, 1600×900, 1440×900, 1366×768, 1280×800 and 768×1024. Desktop screenshots are written to ignored `test-results/`. For an additional live Hideki browser smoke test, set the task-specific `CANARY_UI_LIVE=1` environment variable in PowerShell before running `npm.cmd run test:ui`; this needs read-only outbound RPC/SDK access.
