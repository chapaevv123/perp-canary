# Perp Canary

Perp Canary is a read-only evidence collector for dreamDEX perpetual markets on Somnia Hideki testnet. It uses the official `@somnia-chain/markets-sdk` package to observe market rows, system wiring, factory pool status, and each pool's mark feed. It saves canonical JSON snapshots in a SHA-256 linked chain and serves the verified files through a local web view and API.

**M0 status (26 October 2026):** SDK `0.32.1`, Hideki chain ID `50383`, and RPC/WSS connectivity were checked in a complete `host-m0.ps1` run. Three `LIVE` snapshots are included. The latest records 21 markets at block `33751413`; all 21 received a feed-only `GREEN` verdict at observation time. Six tests, TypeScript typecheck, ESLint, and evidence verification passed after the snapshot process exited. This project has no order execution path, confirmed whitelist, or public deployment.

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

`host-m0.ps1` inspects the installed SDK exports, checks RPC chain ID `50383` and WSS, writes a fresh read-only snapshot, then runs typecheck, lint, tests, and `verify`. The separate `npm.cmd run snapshot` command performs only collection. `npm.cmd run serve` starts the local view at `http://127.0.0.1:8787` with `/api/v1/snapshots`, `/api/v1/latest`, `/api/v1/health`, and `/api/v1/gate`.

| Included snapshot (UTC) | Block | Markets | Feed verdicts | SHA-256 head |
| --- | ---: | ---: | --- | --- |
| 2026-10-26 14:34:43 | 33730827 | 21 | 21 GREEN | `31d75556ed7209c06b611d44990e153b928209a36e957f53462756f9e78f5b49` |
| 2026-10-26 14:50:02 | 33740062 | 21 | 21 GREEN | `cd5e07279a0bd403be8ca60a2ce7d1eceb64fa4981aa8e4dc07b26cb4975d3f5` |
| 2026-10-26 15:09:00 | 33751413 | 21 | 21 GREEN | `5fa7c458f27f878f2b2e8daa8052cf6dea75754145716b990d7038a13ac702f0` |

`verify` checks each snapshot's canonical hash and `previousHash` link. Once this repository is public, its Git commit anchors the included head against replacement of the whole evidence directory. New snapshots extend the chain locally and should be reviewed before any later publication.

## What the evidence means

`GREEN` says only that the observed pool feed reported `markPriceOk`, a nonzero mark, and an index timestamp. `AMBER` means the timestamp was unavailable; `RED` means a confirmed failed or zero mark; `UNKNOWN` means the read failed or its shape was invalid. `/api/v1/gate` remains `UNKNOWN` because execution availability and order conformance are not measured.

Indexer rows can lag the sampled RPC block. System, factory, and feed reads happen after the block sample and are not pinned to it. A valid local hash chain proves internal file consistency, not the current market state or independent truth of the upstream data. Perp Canary does not place orders, manage a wallet, or send transactions. Whitelist access and bounty eligibility remain unconfirmed.

See [architecture](docs/architecture.md) for the data flow. Perp Canary is independent of dreamDEX and Somnia. Original Perp Canary code is licensed under [MIT](LICENSE).
