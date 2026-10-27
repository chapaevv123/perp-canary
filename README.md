# Perp Canary

Perp Canary observes dreamDEX perpetual markets on Somnia Hideki testnet and checks whether a real transaction receipt matches a saved order plan. It uses the official `@somnia-chain/markets-sdk` for market, feed, account and risk reads. M2.6 locks browser-wallet signing and broadcast; only read-only plans and simulations remain available. The local server never holds a key or sends a transaction.

**M0 evidence (26 October 2026):** SDK `0.32.1`, Hideki chain ID `50383`, and RPC/WSS connectivity were checked in a complete `host-m0.ps1` run. Three `LIVE` snapshots are included. The latest records 21 markets at block `33751413`; all 21 received a feed-only `GREEN` verdict at observation time.

**M1 development:** The existing local app now offers live dry-run plans for place, cancel and close operations, and can compare an existing Hideki receipt with a plan. These paths have local tests. No owner wallet, actual order, cancel, close, or receipt has been exercised through this M1 flow yet. The contest whitelist and submission eligibility remain unconfirmed.

**M2 preparation:** The same UI discovers MetaMask/Rabby, checks Hideki chain ID, STT, USDso, MarginBank health, market restrictions, SDK margin/size previews and gas simulation. `buildPlacePerpOrder` produces unsigned calldata. The original M2 browser send control is disabled under the M2.6 execution lock. See [wallet and execution flow](docs/m2-wallet.md).

**M2.2 wallet audit:** Read-only Wallet Architecture Diagnostics now separates the connected EOA from a user-supplied dreamDEX trading wallet, reads each address's Hideki balances, MarginBank state, position and indexed orders, and inspects an existing transaction hash for pool owner events. Missing account links remain `UNKNOWN`. The M2 direct EOA order path does not sign for an app-managed wallet. See [wallet architecture audit](docs/wallet-architecture-audit.md).

**M2.4 network and funding:** The existing dashboard now checks public EOA and trading-wallet balances independently on Hideki 50383, Shannon 50312 and mainnet 5031, verifies each RPC's chain ID, and explains funding readiness, official test routes and unresolved app balances. A LIVE sample found the owner-reported `26.306836 SOMI` amount as a numerical match to Shannon EOA **STT**, while the supplied trading address held Hideki STT and a 1000 USDso MarginBank voucher floor. This does not prove the app token label or account link. See [network and funding intelligence](docs/network-funding-intelligence.md).

**M2.5 live trade forensics:** A supplied public transaction was found only on Hideki. The new read-only dashboard section verifies the transaction, receipt, BTC-PERP market identity, operator calldata, matching fill and trading-wallet position event. A separate committed SHA-256 artifact preserves the raw chain data and bounded call trace; the M0/M1 evidence chains remain intact. See [live trade forensics](docs/live-trade-forensics.md).

**M2.6 trading authorization:** The dashboard now checks Wallet 1 ownership, the official Hideki permission registry, effective/global/per-pool grants for place/cancel/reduce, operator STT, MarginBank, market support and read-only simulation. A delegated `placeOrderFor` prototype produces short-lived unsigned calldata. The historical M2.5 sender is currently authorized but its signer is not available to Perp Canary. No signature or broadcast path is enabled. See [trading authorization audit](docs/trading-authorization-audit.md) and [local Pulse Evolution ledger](docs/pulse-evolution-ledger.md).

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

Indexer rows can lag the sampled RPC block. System, factory, and feed reads happen after the block sample and are not pinned to it. A valid local hash chain proves internal file consistency, not the current market state or independent truth of the upstream data. M2.6 can produce an unsigned testnet PLACE order but cannot submit it. Whitelist access and bounty eligibility remain unconfirmed.

See [architecture](docs/architecture.md) for the data flow. Perp Canary is independent of dreamDEX and Somnia. Original Perp Canary code is licensed under [MIT](LICENSE).

# M3.0 bot foundation

The Bot Connection panel reports local public keystore metadata and live Hideki delegated permissions. Run `npm run bot -- status` in a local terminal. `npm run bot -- create` is an owner-controlled interactive action that creates a new encrypted bot wallet only when deliberately invoked; no bot wallet is bundled with this repository. `npm run bot -- unlock` validates locally and returns to locked state. See [M3.0 bot foundation](docs/m3-bot-foundation.md).

## M3.3 delegated execution

The Execution Control panel prepares an expiring BTC-PERP `placeOrderFor` plan with a SHA-256 hash after fresh read-only permission, market, margin, gas and simulation checks. The browser cannot sign or send. The separate `npm run bot-execute -- execute <plan-hash>` command is reserved for a later, explicit owner decision: it requires an interactive terminal, exact hash confirmation and local keystore password, then repeats all checks before one Hideki send. Do not run it while reviewing or testing M3.3. An uncertain send stays reserved as `UNKNOWN`; use read-only `npm run bot-execute -- reconcile <plan-hash> <tx-hash>` after inspecting the on-chain transaction. See [M3.3 execution guide](docs/m3-delegated-execution.md).

## M3.4 order lifecycle

Execution Control now reads Wallet 1's on-chain BTC-PERP position and resting orders and prepares separate CANCEL and REDUCE_ORDER plans using the documented `cancelOrderFor` and `reduceOrderFor` calls. The latter changes a resting order, **not an open position**. Both write paths use the same local CLI confirmation, signer, durable intent ledger and receipt evidence as PLACE. Position CLOSE remains blocked until an atomic reduce-only delegated method is proven. See [M3.4 demo and evidence guide](docs/m3-4-lifecycle-demo.md). All M3.4 write stages were tested with fixtures only.

Existing public proof: [M2.5 BTC-PERP transaction evidence](trade-evidence/tx-e164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc.json) is a verified **dreamDEX UI trade**, not a Perp Canary execution. [M2.6 authorization evidence](authorization-evidence/authorization-33989411.json) is a historical read-only grant snapshot. Run `npm run verify` for SHA-256 chain verification; LIVE state must always be read again.

## M3.5 first execution review

[M3.5 research and owner checklist](docs/m3-5-readiness.md) records official close-method research, public on-chain close receipts/traces, current read-only BTC-PERP observations, an expired unsaved research plan, fixture dry run, and contest submission gaps. **PLACE is READY_FOR_OWNER_REVIEW for a new owner-selected plan; CLOSE_POSITION remains BLOCKED.** The existing `+0.05416` BTC Wallet 1 LONG is netted: a new BUY increases that LONG. Opposite-side PLACE is blocked while a position exists because an ordinary order has no proven atomic reduce-only guarantee. No bot transaction was submitted in M3.5. For an ephemeral public-data preflight, run `node --experimental-strip-types scripts/m35-readonly.ts <owner-reviewed-buy-limit> 0.00013`; it prints and does not save the result. The current market minimum must still be checked each time. Submission whitelist status and the exact DoraHacks cutoff remain unconfirmed.

## M3.6 execution diagnostics

The failed saved plan `0c522886fcd6410659150d3c5f7572ff1f8b187c50322120f6a38366273b21e5` is expired. Its CLI failure occurred during the saved-calldata gas estimate before confirmation, password, intent reservation or broadcast. The contract error selector was not retained, so the root cause remains `UNKNOWN_REVERT`. The shared decoder now reports confirmed official ABI errors or an explicit unknown, and saves a hash-verified, secret-free local diagnostic instead of a raw viem dump. `npm.cmd run bot-execute -- check <fresh-plan-hash>` repeats PLACE checks without unlocking, signing, reserving or sending. See the [first-trade runbook](docs/m3-6-first-trade-runbook.md) before any separate owner decision. Evolution Score remains **26**.
