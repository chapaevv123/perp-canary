# M12 trading reliability — 2026-10-28

## Scope and evidence

This report concerns Somnia Hideki chain 50383 and dreamDEX perps. No wallet signature, approval, margin transfer, cancel, order or transaction was sent during M12 verification. Browser signing paths used injected mocks. The owner's BTC position and failure screenshots are historical observations, not a live account read available to this session.

Evidence: local source and pinned `@somnia-chain/markets-sdk@0.32.1`; 21 public read-only `/api/v1/markets/snapshot` responses on 2026-10-28 (blocks 35560988–35561218, all `TRUSTED`, `SDK_ONCHAIN_PINNED_AND_DIRECT_HTTPS`); Chromium fixture tests; public Render asset comparison; [official perps rules](https://app.testnet.dreamdex.io/docs/trading/perps-testnet) and [official order rules](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders).

## Owner-reported failures and repairs

| Issue | Root cause or evidence gap | M12 change | Verification and remaining limit |
| --- | --- | --- | --- |
| A. Intermittent Order Blocked | Local input validation, conservative SDK maximum, fresh book, margin, grant and simulation were collapsed into a generic blocked message. The particular owner's failed attempt cannot be reconstructed without timestamped request/Render logs and wallet address. | Blocked plans show their first concrete blocker. SDK maximum is advisory because exact margin preview and contract simulation are mandatory; legitimate grid, exchange minimum, margin, grant, gas and book rules remain hard gates. | Unit tests cover conservative max, custom limits and stale/wrong-chain/no-gas blocks. Live owner outcome remains unverified. |
| B. Opaque preflight failure | Public server catch hid upstream errors behind `REQUEST_REJECTED`; screenshot cannot identify which SDK/RPC operation failed. Seven account reads, registry, fresh book, margin preview, simulation, gas and nonce are all candidates. | Each read now carries a safe named stage, code and retryability. RPC timeout/transport failure is `UNKNOWN / UNAVAILABLE`; confirmed contract revert is `RED / BLOCKED` with official ABI reason where decodable. Direct owner margin checks use SDK `autoPull:true`; delegated checks retain `autoPull:false`. Fresh book is read after account/max-size reads. | Browser test injects a 503 margin-preview timeout and proves no wallet method is invoked. Exact historical failure remains an evidence gap; capture new `phase`, `code`, time and Render log if it recurs. No automatic signing retry. |
| C. RED plus READY FOR REVIEW | Input-only `idleGuard()` used a readiness label; failed preflight catch could leave that label alongside RED. | Input state says `PREFLIGHT REQUIRED / INPUTS COMPLETE`. Failed preflight says `UNKNOWN / UNAVAILABLE`; deterministic block says `RED / BLOCKED`. Failed reviews clear margin/gas proof and wallet confirmation. | Chromium tests cover failed preflight and blocked plan; no wallet send in the failure scenario. |
| D. NEAR quantity 1 | Live `getOrderBookParameters()` returned `minQuantityRaw=5100000000000000000000000`, base decimals 24, lot `100000000000000000000000`: minimum **5.1 NEAR**, lot **0.1 NEAR**. | Ticket separates exchange minimum, lot step and price tick, and identifies current block. It distinguishes minimum failure from lot alignment. No hardcoded per-market limits. | All 21 live snapshots returned trusted dynamic parameters; metadata failure keeps the ticket unavailable. No separate minimum notional was verified in this SDK endpoint. No default custom max; optional wallet-scoped max remains. |
| E. Position versus orders | A 0.05429 BTC long with zero open orders can result from fills; zero resting orders does not mean flat. The entire position has no Perp Canary provenance evidence. | Existing selected-market, owner-scoped on-chain position/open-order reads and verified execution replay remain the evidence path. M12 account refresh clears stale account proof before a new read and invalidates pending review. Margin and position copy is scoped. | Local account/position/history browser paths pass. Current owner address and position cannot be certified without owner wallet read. The recorded 0.00013 BTC verified increment does not attribute the full 0.05429 BTC. |
| F. SELL mistaken for close | Official orders say reduce-only can shrink without flipping, but the pinned `placePerpOrder`/`placeOrder` path here has no verified reduce-only parameter. SDK `reduceOrderFor` reduces a resting order, not a position. | SELL / SHORT now explicitly says directional, not guaranteed close. It links to the official dreamDEX Perps interface and its Positions table. No fabricated Close button. | Verified against official order docs and SDK source. An in-app safe close remains unsupported; use official position controls with the actual owner wallet. |
| G. Wallet/margin controls | Prerequisites were hidden until prepare failed; public catch also obscured failure. Direct actions are Approve, Deposit, Withdraw and Cancel; delegated operator can Cancel only with effective grant. | Ticket explains disabled state from verified account, STT, allowance, wallet USDso, withdrawable margin, open order and cancel grant. Server returns actionable prerequisite errors. | Mocked action review, rejection, receipt and cancel paths pass. Real approvals/transfers/cancels are unverified and require owner confirmation. |
| H. 40.39 notional, 218.235 initial margin, zero lock | SDK `imRequirement` is for **existing positions**, `lockAmount` for **this order**, `topUpRequired` for wallet auto-pull. Thus these numbers can coexist, especially for a reducing order; historical screenshot alone cannot prove that exact economic state. | Ticket labels all three scopes and block. Failed or stale preflight clears verified values. | SDK source types and local browser rendering checked. Exact historical preview requires preserved raw response/account/block. |
| I. Browser acceptance | Previous local suite used fixtures; it did not prove production wallet behavior. | Added failed-stage/browser Guard regression and stage-error safety tests, kept mocked receipt/rejection path, and fixed stale test loading of legacy `readJson`. | 188 unit/integration passed; 24 Chromium passed; 3 gated live tests skipped. Public read-only market queries passed. No live wallet or signing claim. |
| J. Deployment | `render.yaml` defines the existing free Docker service but does not reveal Dashboard branch, auto-deploy state or deployed SHA. GitHub deployments API has zero records. HTTP 200 is only availability. | No speculative Blueprint or paid-service change. | GitHub pre-push `main` was `30f89529711dbe3df23e821054344fe5cf6ea42e`; public `trading.js` still contained `READY FOR REVIEW` and lacked M12 marker. Owner must inspect Render Dashboard deploy SHA and deploy latest commit on existing service if stale. |

## Live market quantity rules

These are observations, not constants. Each row came from a trusted production snapshot on 2026-10-28. The application reads these values afresh from verified market metadata; unavailable or stale metadata blocks review. Price tick is also read per market and shown in the ticket. No separate minimum-notional field was verified by this endpoint.

| Market | Exchange minimum | Lot step | Market | Exchange minimum | Lot step |
| --- | ---: | ---: | --- | ---: | ---: |
| BTC-PERP | 0.00013 | 0.00001 | ETH-PERP | 0.004 | 0.0001 |
| SOL-PERP | 0.1 | 0.01 | HYPE-PERP | 0.12 | 0.01 |
| XRP-PERP | 6.9 | 0.1 | DOGE-PERP | 120 | 10 |
| BNB-PERP | 0.014 | 0.001 | ADA-PERP | 46 | 1 |
| SUI-PERP | 13 | 1 | LINK-PERP | 0.9 | 0.1 |
| AVAX-PERP | 1.4 | 0.1 | XLM-PERP | 54 | 1 |
| NEAR-PERP | 5.1 | 0.1 | WLD-PERP | 26 | 1 |
| TAO-PERP | 0.044 | 0.001 | ZEC-PERP | 0.009 | 0.001 |
| VVV-PERP | 0.44 | 0.01 | LIT-PERP | 2.8 | 0.1 |
| ZRO-PERP | 5.1 | 0.1 | PUMP-PERP | 1800 | 100 |
| 1000PEPE-PERP | 2700 | 100 | | | |

## Acceptance and release gate

`npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd test` (188/188), and `npm.cmd run test:ui` (24/24 active, 3 skipped) passed locally. The browser flow includes connect state, selected market, quantity, bid/ask, Guard, review, mocked wallet rejection and receipt, actions, orders, positions, history and responsive layout. These fixture results do not certify the owner's live wallet.

**Verdict: NOT READY — SPECIFIC BLOCKERS.** The public Render build does not yet expose M12, the deployed SHA is not publicly verifiable, and the owner's real wallet preflight and position-close route remain unverified. The exact historical preflight cause requires a fresh staged error or Render log. Owner should first confirm Render deployed SHA equals GitHub main, then read-only connect and review the same BTC SELL parameters; do not sign for this diagnostic. Use the official dreamDEX Positions table for any close/reduce action.
