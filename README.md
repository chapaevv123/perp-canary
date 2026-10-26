# Perp Canary

Perp Canary observes dreamDEX perpetual markets on Somnia Hideki testnet and checks whether a real transaction receipt matches a saved order plan. It uses the official `@somnia-chain/markets-sdk` for market, feed, account and risk reads. A browser wallet can submit a testnet PLACE order only after a fresh preflight, a separate on-screen decision and a separate wallet confirmation. The local server never holds a key or sends a transaction.

**M0 evidence (26 October 2026):** SDK `0.32.1`, Hideki chain ID `50383`, and RPC/WSS connectivity were checked in a complete `host-m0.ps1` run. Three `LIVE` snapshots are included. The latest records 21 markets at block `33751413`; all 21 received a feed-only `GREEN` verdict at observation time.

**M1 development:** The existing local app now offers live dry-run plans for place, cancel and close operations, and can compare an existing Hideki receipt with a plan. These paths have local tests. No owner wallet, actual order, cancel, close, or receipt has been exercised through this M1 flow yet. The contest whitelist and submission eligibility remain unconfirmed.

**M2 preparation:** The same UI discovers MetaMask/Rabby, checks Hideki chain ID, STT, USDso, MarginBank health, market restrictions, SDK margin/size previews and gas simulation. `buildPlacePerpOrder` produces unsigned calldata. The owner may separately authorize each testnet send in the browser wallet; none has been sent or verified here. See [wallet and execution flow](docs/m2-wallet.md).

**M2.2 wallet audit:** Read-only Wallet Architecture Diagnostics now separates the connected EOA from a user-supplied dreamDEX trading wallet, reads each address's Hideki balances, MarginBank state, position and indexed orders, and inspects an existing transaction hash for pool owner events. Missing account links remain `UNKNOWN`. The M2 direct EOA order path does not sign for an app-managed wallet. See [wallet architecture audit](docs/wallet-architecture-audit.md).

**M2.4 network and funding:** The existing dashboard now checks public EOA and trading-wallet balances independently on Hideki 50383, Shannon 50312 and mainnet 5031, verifies each RPC's chain ID, and explains funding readiness, official test routes and unresolved app balances. A LIVE sample found the owner-reported `26.306836 SOMI` amount as a numerical match to Shannon EOA **STT**, while the supplied trading address held Hideki STT and a 1000 USDso MarginBank voucher floor. This does not prove the app token label or account link. See [network and funding intelligence](docs/network-funding-intelligence.md).

## How it works

```text
Hideki RPC ── chain ID, block ───────────────┐
Markets SDK ── indexer market rows ──────────┤
Markets SDK ── system, factory, feed reads ──┼─> canonical JSON + SHA-256 links
                                              └─> local verifier ─> API + web view
```

The collector calls these confirmed SDK methods on a `SomniaMarkets` client:

| Method | Observation |
| --- | --- |
| `listPerpMarkets()` | Indexer market rows |
| `getPerpSystemConfig(marginBank)` | MarginBank system configuration |
| `listPerpPoolStatuses({ factory })` | Factory registration, restrictions, and tradeability fields |
| `getPerpFeedStatus(poolAddress)` | Per-pool mark feed status |

The SDK is configured for Hideki WSS and the dreamDEX indexer, without a signer. `SomniaMarkets.close()` releases its owned WebSocket after collection, including failure paths. A 180-second collection deadline reports the current read phase; the host script also bounds the snapshot subprocess to 240 seconds. These limits fail the run with a diagnostic and retain existing evidence.

## Reproduce the evidence

Requirements: Windows PowerShell, Node.js 22.18+, npm, and outbound HTTPS/WSS access to the endpoints shown in `src/live.ts`. No wallet or private key is needed.

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\host-m0.ps1
```

`host-m0.ps1` inspects the installed SDK exports, checks RPC chain ID `50383` and WSS, writes a fresh read-only snapshot, then runs typecheck, lint, tests, and `verify`. The separate `npm.cmd run snapshot` command performs only collection. `npm.cmd run serve` starts the local view at `http://127.0.0.1:8787`. Its M1 forms run read-only SDK preflight and inspect a transaction hash supplied by the user. See [Execution Integrity](docs/execution-integrity.md) for the exact API and manual workflow.

| Included snapshot (UTC) | Block | Markets | Feed verdicts | SHA-256 head |
| --- | ---: | ---: | --- | --- |
| 2026-10-26 14:34:43 | 33730827 | 21 | 21 GREEN | `31d75556ed7209c06b611d44990e153b928209a36e957f53462756f9e78f5b49` |
| 2026-10-26 14:50:02 | 33740062 | 21 | 21 GREEN | `cd5e07279a0bd403be8ca60a2ce7d1eceb64fa4981aa8e4dc07b26cb4975d3f5` |
| 2026-10-26 15:09:00 | 33751413 | 21 | 21 GREEN | `5fa7c458f27f878f2b2e8daa8052cf6dea75754145716b990d7038a13ac702f0` |

`verify` checks each snapshot's canonical hash and `previousHash` link. Once this repository is public, its Git commit anchors the included head against replacement of the whole evidence directory. New snapshots extend the chain locally and should be reviewed before any later publication.

## What the evidence means

`GREEN` says only that the observed pool feed reported `markPriceOk`, a nonzero mark, and an index timestamp. `AMBER` means the timestamp was unavailable; `RED` means a confirmed failed or zero mark; `UNKNOWN` means the read failed or its shape was invalid. `/api/v1/gate` remains `UNKNOWN` because execution availability and order conformance are not measured.

Indexer rows can lag the sampled RPC block. System, factory, and feed reads happen after the block sample and are not pinned to it. A valid local hash chain proves internal file consistency, not the current market state or independent truth of the upstream data. M2 can offer an unsigned testnet PLACE order to the owner's browser wallet; no owner transaction has been executed in this development run. Whitelist access and bounty eligibility remain unconfirmed.

See [architecture](docs/architecture.md) for the data flow. Perp Canary is independent of dreamDEX and Somnia. Original Perp Canary code is licensed under [MIT](LICENSE).
