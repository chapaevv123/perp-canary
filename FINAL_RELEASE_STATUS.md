# Perp Canary — M10 final release status (2026-10-28)

**Verdict: BLOCKED for wallet-connected competition release and DoraHacks submission.** The read-only public demo is live. A reported MetaMask phishing warning remains unexplained and the actual Render deploy SHA is not exposed publicly. No wallet connection or signing was attempted during this closure.

## Verified release evidence

- Live URL: https://perp-canary.onrender.com/ — HTTPS `200`, `/api/v1/health` `200`, public unsigned-prepare mode, Content Security Policy restricted to self, HSTS enabled.
- GitHub `main` at the production smoke: `1718b717b0461d6ebea1bf211b9631146c64c439`, confirmed with `git ls-remote` on 2026-10-28. Six production JavaScript assets matched this checkout byte-for-byte; CSS matched by content after CRLF/LF normalization. This supports code parity but does **not** independently identify Render's exact deploy commit. The final documentation-only closure commit is available at https://github.com/chapaevv123/perp-canary/commits/main.
- Live API: 21 verified PERP markets. BTC-PERP and ETH-PERP snapshot requests returned chain `50383`, positive marks and `TRUSTED` pinned books from `SDK_ONCHAIN_PINNED_AND_DIRECT_HTTPS` at blocks `35476576` and `35476594` during the smoke.
- Browser: desktop 1440×900 and mobile 390×844 returned `200`, live BTC mark and trusted book, no page errors, no document-level horizontal overflow. Market Radar, Journal, Alerts and Position Sizing panels opened; Canary Guard was present. The stateless sizing calculation returned an `ESTIMATED` quantity of `0.00123 BTC` for a hypothetical input and explicitly warned that the stop is not installed. A read-only public Journal request returned three indexed BTC rows. No wallet confirmation was invoked.
- Focused tests: see final recorded test result below. No full development audit was repeated.

## Security and warning

- Source audit found no third-party script in the public page, no untrusted redirect and no seed/private-key or message-signature request. Wallet connection uses `eth_requestAccounts` on a user click. `wallet_switchEthereumChain` / `wallet_addEthereumChain` are explicit network actions. `eth_sendTransaction` is reachable only after reviewed voucher, order or account-action flows; no autonomous browser send was found. The public server uses exact HTTPS Host/Origin checks, an allowlist of routes, self-only script CSP, and returns unsigned plans.
- `render.yaml` declares only public configuration (`NODE_ENV`, port, bind host and public mode); no secret value or signing key is configured there. The public health response exposes no secret. Render dashboard environment variables could not be inspected from the public site and require owner confirmation.
- [MetaMask's official Why Blocked utility](https://metamask.github.io/eth-phishing-detect/) returned **“This domain is not blocked”** for `perp-canary.onrender.com` on 2026-10-28. This does not explain or invalidate the owner's reported phishing warning, which may come from a different security signal. No bypass or false-positive claim is made. [Official reporting guidance](https://support.metamask.io/ru/stay-safe/safety-in-web3/deceptive-site-ahead-when-trying-to-connect-to-a-site/) and a [copy-ready review draft](docs/submission/metamask-review-request.md) are prepared.

## Known limitations and exact owner actions

- Render Free can cold start after inactivity. Quotes depend on the Hideki RPC, SDK and indexer; partial source failure is surfaced. Alerts work only while the browser tab is open. Verified 24h change/volume, complete fees/realized PnL, guaranteed reduce-only close, live cancellation and direct EOA trade are not claimed.
- Owner: capture the exact MetaMask warning screenshot, URL, browser/extension version and time; send the prepared review request to MetaMask. Until resolved, do not connect or sign on the flagged URL.
- Owner: check the Render dashboard's deployed commit against GitHub `main` and inspect environment variables for unexpected secrets or wallet credentials. Do not add paid hosting.
- Owner: confirm DoraHacks email whitelist, exact deadline and form requirements in the authenticated portal; review the [copy-ready submission checklist](docs/m9-owner-submission-checklist.md), then submit manually. No DoraHacks submission was made here.

**Focused tests result:** 19/19 passed (`m7-public-server`, `m7-product`, `wallet-browser`, `m8-intelligence`, `m7-browser-logic`); `git diff --check` passed. These tests cover public route/origin controls, wallet send gating, Guard, Radar, Alerts, Journal and position sizing logic.
