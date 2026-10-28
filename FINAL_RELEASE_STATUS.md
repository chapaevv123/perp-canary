# Perp Canary — M12 trading reliability status (2026-10-28)

**Verdict: NOT READY — SPECIFIC BLOCKERS.** M12 repairs pass local tests, but the public Render build is stale and real owner wallet acceptance has not occurred.

## Version and production

- M12 implementation commit on GitHub: `e08b740d76c906295d3806eec15d03f2a6090599`, verified with `git ls-remote` after push. The [GitHub main commit page](https://github.com/chapaevv123/perp-canary/commits/main) shows the current branch tip, including this status update; the final handoff reports its full SHA.
- Public Render `/api/v1/health` returned HTTP 200 on 2026-10-28, but does not expose a commit SHA. Public `/trading.js` contained old `READY FOR REVIEW` and lacked M12 `PREFLIGHT REQUIRED` and close guidance. **M12 is not confirmed deployed.**
- GitHub deployments API returned zero records. `render.yaml` declares the existing free Docker service but does not prove Render Dashboard auto-deploy configuration or explain why the prior Blueprint stayed on M9 `1718b71`. No repository-side deployment setting was changed without evidence.

## Functional state

- **Trading limit:** no default custom application maximum and no artificial 100 USDso cap. Optional positive maximum remains scoped to connected wallet and mode; exchange grid, margin, gas, permissions and exact simulation still apply. Values above 100 USDso were checked without orders.
- **Order type:** PostOnly is a static supported label. BUY / SELL are directional orders. SELL / SHORT is not a guaranteed close.
- **Guard and preflight:** input readiness is separate from verified readiness. Failed read-only preflight is `UNKNOWN / UNAVAILABLE`, with a named failed stage, safe retry guidance and no wallet send. Confirmed blocks are `RED / BLOCKED` with a concrete reason. Direct margin previews now use official SDK `autoPull:true`; delegated previews remain `autoPull:false`.
- **Exchange rules:** 21 supported markets returned trusted live SDK/chain quantity minimums, lot steps and price ticks. NEAR minimum is 5.1 NEAR, lot 0.1 NEAR. No separate exchange minimum notional was verified. Stale or unavailable metadata blocks review.
- **Positions and closing:** selected market positions and open orders remain separate read-only observations. The owner's historical 0.05429 BTC long is not attributed to Perp Canary as a whole. The pinned SDK path does not expose a verified reduce-only position close, so this app links to the official dreamDEX Positions interface. No fake Close action was added.
- **Wallet controls:** Approve, Deposit, Withdraw and Cancel have visible prerequisites and fresh backend checks; delegated operators only have Cancel with a verified grant. Live wallet actions remain unverified.
- **Margin and fees:** this order's lock, existing positions' initial requirement and wallet top-up have distinct labels. Official testnet docs list zero maker/taker fees; funding and gas remain separate chain-dependent amounts.

## Verification

| Gate | Result |
| --- | --- |
| ESLint, TypeScript typecheck, build | Passed locally |
| Unit/integration | 188 passed, 0 failed |
| Local Chromium | 24 passed, 0 failed; 3 gated live tests skipped and not counted |
| Public market metadata | 21/21 trusted read-only snapshots |
| Real owner MetaMask signing / trading | Unverified; no signatures or transactions requested |
| Public Render M12 build | Not verified; observed asset is older |

## Minimal owner actions

1. In **Render Dashboard → perp-canary → Events/Deploys**, compare the latest **Live** deploy's full source commit SHA with GitHub `main`. If old, use **Manual Deploy → Deploy latest commit** on the existing free service and wait for **Live**. Do not create or pay for a new service. Reload `https://perp-canary.onrender.com/` and check the ticket says `PREFLIGHT REQUIRED / INPUTS COMPLETE` before review.
2. With the owner MetaMask, check address, chain ID **50383**, selected market, margin owner and permissions. Select BTC-PERP SELL, quantity `0.0005`, a fresh non-crossing PostOnly price, and click **Review wallet order**. Record `phase`, `code`, exact message, timestamp and Render log if it fails. This diagnostic requires **no signature**; stop before wallet confirmation.
3. Check the actual BTC position and open orders under the same owner account. If closing is desired, use the official dreamDEX Perps **Positions** controls and their reduce-only safeguard; Perp Canary SELL is directional.

Full evidence and issue-by-issue limitations: [M12 trading reliability report](docs/M12_TRADING_RELIABILITY_REPORT.md).
