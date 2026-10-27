# M6.3 release readiness and deployment boundary

## Position reduction

The 2026-10-27 live read in [verified evidence](evidence/verified-delegated-btc-order.json) saw Wallet 1 BTC position **+0.05429 BTC** and no open BTC orders at block 34799323. This position can change; it must be re-read before any future order.

The installed `@somnia-chain/markets-sdk@0.32.1` exposes `intent: "reduceOnly"` for stop/TP-SL order APIs, but its delegated pool `placeOrderFor` signature has no reduce-only argument. The pool's `reduceOrderFor` reduces the remaining size of an **open order**, not an existing position. The stop registry path builds a signer-owned transaction and is not proven to preserve Wallet 1 ownership through this operator's delegated pool grant. A normal opposite-side SELL could add a short after a race or partial fill. Perp Canary therefore provides **no guaranteed delegated reduce-only position-close action**. It does not infer safety from the current position alone. No close transaction was prepared, signed or sent.

Protocol references: [developer contract functions](https://app.testnet.dreamdex.io/docs/developers/contracts/functions), [perps order types](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/orders). A future implementation needs a documented owner-scoped reduce-only contract route, permission check, fresh position and grant reads, simulation, and wallet-confirmed lifecycle tests.

## Local production package

`npm.cmd run build` typechecks the application and creates `dist/` with runtime source, browser assets, lockfile, the historical proof inputs needed by the local server, and a SHA-256 manifest for its index page. This is a **local release package**, not a public deployable bundle. Run it from its own directory after installing production dependencies:

```powershell
npm.cmd run build
cd dist
npm.cmd ci --omit=dev
npm.cmd run serve
```

Health endpoint: `http://127.0.0.1:8787/api/v1/health`. The server binds `127.0.0.1`; Host and POST Origin guards accept only localhost. No browser secret, private key or bot keystore is included in `dist/`. Keep the release directory private because its local research artifacts and historical API are not designed as public endpoints.

## Public hosting gate

**Not ready for direct Internet exposure.** This server includes owner research and bot diagnostic routes alongside public trading reads, has no public origin allowlist, no public rate limit, and no approved HTTPS frontend. A reverse proxy alone would not make its localhost Host/Origin checks work for a real domain. The release needs a separately reviewed public API route allowlist, strict HTTPS host/origin configuration, abuse limits, production RPC capacity, request logging without sensitive inputs, and a deployment smoke using a real HTTPS origin and MetaMask chain switching. Keep the server loopback-only until those changes pass security review and the owner approves deployment. No deployment credentials or approved hostname were supplied, and no deployment was attempted.

## Evidence classes

| Class | Current evidence |
| --- | --- |
| LIVE ON-CHAIN | Successful placement and fill receipts plus exact BTC pool events for order `14978756187852164141712` |
| LIVE READ-ONLY | Wallet 1 current position/open orders and official SDK indexer state at timestamped blocks |
| SIMULATED | Fresh unsigned trade and cancel contract simulations; no signature implied |
| MOCKED | Chromium wallet flows and responsive screenshots labeled as mocked |

## Submission blockers

The [submission draft](m6-submission-pack.md) is prepared. DoraHacks email whitelist, exact cutoff, judging criteria, category and required public fields were not independently retrievable from the official portal. A public repository and HTTPS demo also require separate owner approval and the public hosting gate above. The release is **CONDITIONAL** for local judge demo and **not ready for public deployment or submission** until those owner and hosting steps are resolved.
