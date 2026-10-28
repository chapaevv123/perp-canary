# M9 public launch report — 2026-10-28

## GitHub publication

The existing public repository is https://github.com/chapaevv123/perp-canary on `main`. The M8 commit `061bd186043742bda60ab7aa5a8b8f1154f8355c` was pushed as a fast-forward from `7af2e81`; `git ls-remote` confirmed the remote SHA. README is available through the GitHub API. The untracked `design/` file was not included. No force-push or unrelated deletion occurred.

## Public HTTPS preview and production gate

A free Cloudflare Quick Tunnel served the existing Node app in strict public mode at https://bodies-radio-irrigation-assume.trycloudflare.com during acceptance. It had `NODE_ENV=production`, `CANARY_PUBLIC_ENABLED=1`, an exact `CANARY_PUBLIC_ORIGIN`, and a loopback server on port 8791. This is a **temporary public preview**, not a durable production deployment: Cloudflare changes the hostname when the tunnel restarts, provides no uptime guarantee, and says Quick Tunnels are for testing. The URL depends on the local server and tunnel processes.

No suitable authenticated hosting account or hosting API credential was found. Render offers a $0 Node/Docker web service and `render.yaml` is prepared with health checks and strict public mode. Render's free service sleeps after 15 minutes of inactivity and its documentation says free instances are for hobby/testing rather than production. A Render account connection is required before creating the service; no paid subscription or infrastructure purchase was made. The final production URL remains **unverified**. See [production acceptance](m9-production-acceptance.md).

## Public read-only observations

Chromium loaded the public HTTPS page, all 21 verified market options, static assets, trusted BTC and ETH books, and 120 real BTC fill-derived candles. The full Radar scan returned 21 quote snapshots, 19 scored rows and two rows without a current confident score. The browser created an alert, reloaded, confirmed persistence, and deleted it. The official SDK Journal returned three distinct Wallet 1 BTC orders and linked the verified Canary replay. The test injected only a read-only public account identity; it blocked all signing/sending methods. No wallet connection, signature, order or position change was made. Mobile width remained 390 CSS pixels at a 390-pixel viewport.

Public API checks: HTTPS and HSTS, health 200, cross-origin POST 403, disallowed bot route 403. The browser did not expose private diagnostic routes. These checks cover the temporary preview URL and must be repeated on any durable deployment. Four screenshots with `m9-public-preview-` filenames are actual public preview captures, not fixtures or production captures.

Final local M9 gates: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, **184/184** unit/integration tests and **18/18** standard Chromium browser tests passed. Three optional live scenarios are skipped by the standard browser command; the separate public HTTPS smoke above exercised live read-only data. Durable-host acceptance must still be recorded before marking production ready.

## Competition status

The owner reports a visible DoraHacks platform deadline of **2026-11-02 01:59 UTC+2** and a disabled Submit Build button. Whitelist approval is unconfirmed. The existing dreamDEX/Somnia Discord support ticket includes @emrey.somi; the prior event invitation expired. Automated access to the official DoraHacks page returned 405, so the current form status and required fields were not independently verified. No new whitelist request or competition submission was sent.
