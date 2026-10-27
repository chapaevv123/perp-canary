# M4.0.1 BTC-PERP market-data integrity incident

No transaction was signed or broadcast in this hotfix. The existing Wallet 1 LONG was not changed. The untracked `design/` directory is unrelated and preserved.

## Incident and root-cause boundary

The owner reported a read-only `READY_FOR_OWNER_REVIEW` result for a PostOnly BUY at `79700` USDso and `0.00013` BTC while the check displayed best bid `79868.0` above best ask `79863.1`. For a normal two-sided continuous book that is crossed and **untrusted**. The reported check did not retain a block hash, raw SDK response or receipt, so its precise cause is **UNKNOWN**. Do not infer a fill, an SDK bug, a unit conversion error or a protocol rule from those two displayed prices alone.

An immutable saved plan at `2026-10-27T08:47:11.647Z`, block `34386440`, recorded raw bid `79866000000000000000000` and ask `79869600000000000000000` (normalized `79866.0 / 79869.6`), both valid at preparation. The later reported crossed check had no saved block number. This proves the plan's recorded book differed from the later displayed book, but does not identify what changed or which read failed.

## Acquisition trace and guarantees

`inspectTradingAuthorization` identifies BTC-PERP through the Markets SDK's market row (indexer), reads the official pool address, then calls SDK 0.32.1 `getBookTopsOnchain([{id: pool, poolAddress: pool}], {blockNumber})`. The SDK source at `node_modules/@somnia-chain/markets-sdk/dist/orders.js` pins one block number, requests `getBookLevels(true,1)` and `getBookLevels(false,1)` from the pool, and returns raw decimal-string `price` values. It does not normalize, reorder or swap sides. Where Multicall3 is available the two calls are batched; otherwise the SDK fans out two reads at the same block number. The [official contract docs](https://app.testnet.dreamdex.io/docs/developers/contracts/functions) define `getBookLevels` by side; the [contract type docs](https://app.testnet.dreamdex.io/docs/developers/contracts/types) define raw `uint256` prices. BTC-PERP quote decimals and tick come from the official SDK market row. The mark feed, grants and margin are separate reads and do not constitute one atomic global snapshot.

Pinning a block number makes bid/ask comparable within one canonical chain state if the RPC serves that state consistently. The SDK does **not** return the block hash or an atomicity proof for WS fan-out. The hotfix therefore fetches the same pinned block over official HTTPS before and after the book reads and independently reads both `getBookLevels` sides over HTTPS. Any missing metadata, block-hash change or SDK/HTTPS price disagreement blocks execution. Matching values reduce RPC race risk but cannot prove what an earlier unsaved check saw.

## Enforced rules

`src/market-integrity.ts` requires BTC-PERP and its allowlisted pool, two positive unsigned raw prices, `bid < ask`, 18 quote decimals, tick alignment, the same pinned block number, a real block hash stable before/after reads, and exact SDK/direct-RPC raw price agreement. It checks the real block timestamp and read completion time against a **30-second** freshness threshold, with at most 5 seconds of future clock skew. An obvious tenfold mismatch against an available mark is blocked as a unit warning. Missing timestamps are `MISSING_FRESHNESS_METADATA`; no timestamp is inferred from the local clock. No price is swapped, averaged or changed automatically.

Preparation validates the book before producing a `PREPARED` plan. `bot-execute check`, the first execution preflight, the post-confirmation preflight and the final pre-sign check validate again. A saved plan's book is validated at **its own recorded observation time**; each live recheck needs a new 30-second-fresh book. Old plans lacking the new provenance fail closed. The IOC and PostOnly delegated PLACE paths share this rule. An invalid snapshot becomes `UNTRUSTED_MARKET_SNAPSHOT`, with raw bid/ask, reason codes, source, block and timestamp in the short CLI report or hash-verified local diagnostics. Transaction sent is `NO`; the estimate, signer and broadcast are not reached after the integrity failure.

## LIVE read-only observations

All rows below are BTC-PERP pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, source `Markets SDK 0.32.1 on-chain WS` checked against direct official Hideki HTTPS RPC at each pinned block. Raw prices are 18-decimal USDso; every SDK/direct pair matched. UTC block timestamps were read from chain, and no sample was crossed or locked.

| Block | UTC block time | Raw bid / ask | Normalized bid / ask | Integrity |
| --- | --- | --- | --- | --- |
| 34390433 | 08:53:49 | `79831400000000000000000` / `79850400000000000000000` | 79831.4 / 79850.4 | uncrossed |
| 34390469 | 08:53:53 | `79831400000000000000000` / `79850800000000000000000` | 79831.4 / 79850.8 | uncrossed |
| 34390494 | 08:53:55 | `79831400000000000000000` / `79851600000000000000000` | 79831.4 / 79851.6 | uncrossed |
| 34394175 | 09:00:03 | `79901600000000000000000` / `79924900000000000000000` | 79901.6 / 79924.9 | TRUSTED |
| 34394226 | 09:00:09 | `79901600000000000000000` / `79926200000000000000000` | 79901.6 / 79926.2 | TRUSTED |
| 34394259 | 09:00:12 | `79902800000000000000000` / `79923300000000000000000` | 79902.8 / 79923.3 | TRUSTED |
| 34395667 | 09:02:33 | `79875500000000000000000` / `79875600000000000000000` | 79875.5 / 79875.6 | TRUSTED |

The integrated authorization read at block `34395667` also observed chain `50383`, supported place/cancel grants, `1000` unlocked USDso, `5` STT bot gas and the unchanged raw position `5416000` (`+0.05416 BTC`). These values are historical; every future plan must refresh them. The crossed condition was **not reproduced** in these seven observations.

## Owner recovery

From PowerShell in the repository, run read-only `node --experimental-strip-types scripts/m401-market-check.ts`. For several independently pinned observations, run `node --experimental-strip-types scripts/m401-book-probe.ts`. Review raw prices and metadata. If any result is `UNTRUSTED_MARKET_SNAPSHOT`, stop and retain the diagnostics; do not execute or reuse a prepared plan. After a trusted fresh read, manually choose a new limit and run `npm.cmd run canary-prepare -- BUY <owner-selected-limit> 0.00013`, then `npm.cmd run bot-execute -- check <new-plan-hash>`. This hotfix does not authorize the separate `execute` step.
