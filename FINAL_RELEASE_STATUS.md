# Perp Canary — M11 final release status (2026-10-28)

**Verdict: NOT READY.** Local product acceptance passed, but the public Render service still served older trading assets during the resumed audit. The Render deploy SHA is not exposed publicly, and live owner MetaMask checks remain unverified.

## Version and deployment

- GitHub `main` at the resumed audit: `2c46bfc99819d5b2b4da92f044f2dd6145ee2820`, verified by `git ls-remote`. M11 implementation and final control audit are committed in `3f15e04` after that observation; the current report revision is on [GitHub main](https://github.com/chapaevv123/perp-canary/commits/main).
- Render `https://perp-canary.onrender.com/` returned HTTP 200. Its `/`, `trading.js`, `terminal.js`, `preflight-compare.js`, `guard-v2.js`, and `terminal.css` differed from local M11 files; the public trading script and page lacked M11 markers. **Production deployment of M11 is not verified and the observed assets are stale.** HTTP 200 and live market data are not deploy proof.
- `render.yaml` declares the existing free Docker web service, `/api/v1/health`, and public unsigned API mode. It does not declare a paid plan or contain a secret value. Dashboard environment values and deployed SHA require owner inspection.

## Product acceptance

| Measure | Result |
| --- | --- |
| Initial controls audited | 102 |
| Local controls passed | 101 |
| Existing control families repaired or made truthful | 8 |
| Confirmed local control failures remaining | 0 |
| Controls blocked from a PASS claim | 1 external official documentation destination; live wallet actions remain separately unverified |
| Unit/integration | 186 passed, 0 failed |
| Local Chromium | 23 passed, 0 failed; 3 gated live tests skipped |
| Quality gates | ESLint, TypeScript typecheck, build, `git diff --check` passed |

The 100 USDso application cap is removed. No custom maximum applies by default. A positive optional maximum is scoped to the connected EOA and account mode, persists in browser storage, and is enforced in preview and server preflight. Deterministic checks accepted 500, 1,000 and 10,000 USDso without a Canary-only cap; protocol maximum, margin, grid, gas and permission gates still apply. No order was submitted in this audit.

The misleading order-type dropdown is replaced by a static **PostOnly (supported)** label. Only verified BUY/SELL PostOnly preparation is exposed. The local owner-only legacy diagnostics page's inline script and CSS were blocked by the shared CSP; they now load as first-party files and the navigation/browser audit passes without CSP errors. Public mode still denies the legacy routes.

The owner reports MetaMask now connects without a phishing warning. The old warning is **not** treated as an active blocker. This audit used a read-only EIP-1193 mock and did not reproduce the owner's actual extension, request a signature, or initiate a blockchain transaction. Live connect, account/chain identity, permissions, account switch, and disconnect remain owner-verifiable. Live order placement, cancellation and protective stops are not certified.

## Required owner actions

1. Open Render Dashboard → `perp-canary` → Events/Deploys. Check the latest deploy status and full commit SHA against GitHub `main`. If the deploy is older, use **Manual Deploy → Deploy latest commit** on the existing free service and wait for **Live**. Confirm the public page exposes Trading Limits and static PostOnly and that its six audited assets match the deployed commit. No paid setting change is needed.
2. At the exact HTTPS origin above, use the owner's MetaMask to verify the selected EOA, Hideki chain ID **50383**, margin owner and permissions, then switch account and disconnect. Do not sign or send a transaction for this check. Record the exact text if any warning returns.
3. After production parity and wallet checks, review the competition checklist and submit the DoraHacks application manually. This audit did not submit it.

Detailed control evidence: [M11 full product acceptance](docs/M11_FULL_PRODUCT_ACCEPTANCE.md).
