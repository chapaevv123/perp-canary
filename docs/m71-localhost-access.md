# M7.1 localhost navigation fix — 2026-10-28

## Root cause

The local server checked `Sec-Fetch-Site: cross-site` before distinguishing a browser's top-level navigation from an API call. Firefox can classify a navigation to `http://127.0.0.1:8787/` from another page as cross-site. The old policy returned `403 {"error":"Cross-site requests are blocked"}` even though the exact localhost Host was valid and the navigation carried no Origin. A plain curl GET without Fetch Metadata returned HTML, which hid the bug in earlier tests. This was a Fetch Metadata policy error, not a CORS wildcard issue.

## Fix and boundaries

Local mode accepts cross-site Fetch Metadata only for `GET /` or `GET /index.html` when `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`, Origin is absent, and Host is exactly `127.0.0.1:<configured port>` or `localhost:<configured port>`. Local API requests still reject cross-site Fetch Metadata and a mismatched Origin; POST still requires the exact local Origin. Public mode retains its separate HTTPS Host/Origin policy, route allowlist and cross-site rejection.

## Restart and verify

Stop the existing `npm.cmd run serve` process with `Ctrl+C`, then from the project root run `npm.cmd run serve`. Open `http://127.0.0.1:8787/` or `http://localhost:8787/` in Firefox. The page should have HTTP 200 and `text/html; charset=utf-8`.

The integration test sends real HTTP requests with browser Fetch Metadata for both loopback hosts and checks same-origin API success, cross-origin API rejection, and public HTTPS restrictions. Full gates: `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test:ui`, and `npm.cmd run build`.

Verified after restarting the actual local server on port 8787: both loopback GET `/` requests with `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document` returned HTTP 200, `text/html; charset=utf-8`, and the Perp Canary title. A cross-site GET `/api/v1/health` still returned 403. Full run: 177 unit/integration tests passed; Chromium 11 passed, 1 optional live smoke skipped; lint, typecheck and build passed.
