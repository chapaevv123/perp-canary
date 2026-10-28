# M7 public HTTPS deployment runbook

Target: a small Node.js 22 VPS behind Caddy. No paid API key is required. Deployment is **prepared, not performed**; the owner must approve a domain, VPS and publication. Run a staging smoke before public promotion.

1. On a private build machine, run `npm.cmd ci`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:ui`, then `npm.cmd run build`.
2. Transfer the `dist/` release directory privately to the VPS. Do not expose it as a static web root. From `dist/`, run `npm ci --omit=dev` and confirm Node.js 22.18+.
3. Configure the service with `CANARY_PORT=8787`, `CANARY_PUBLIC_ENABLED=1` and `CANARY_PUBLIC_ORIGIN=https://YOUR_APPROVED_DOMAIN`. Keep the Node listener on `127.0.0.1`.
4. Install Caddy and adapt [Caddyfile example](../deploy/Caddyfile.example) to the same approved domain. Caddy terminates HTTPS, forwards the exact Host, and overwrites `X-Forwarded-For` with the peer address. Never use `CANARY_PUBLIC_ORIGIN=http://...`.
5. Health check: `curl https://YOUR_APPROVED_DOMAIN/api/v1/health`. Verify HTTPS, the CSP and HSTS headers, the selected wallet's Hideki network switching, live market reads, real indexer history, a fresh delegated review **without signing**, and an execution replay. Confirm `/legacy` and `/api/v1/bot-execution` return 403 externally.
6. Check rate limit behavior without flooding the official RPC. Caddy/host firewall should allow inbound 80/443 only; the Node port remains loopback. Monitor 5xx, response times and RPC/indexer failures without logging order calldata or wallet secrets.
7. Publish the repository and demo only after the owner approves the exact URL and contents. Submit on DoraHacks manually after confirming whitelist and portal rules.

Public mode accepts only the named UI/static paths and wallet/trading read/unsigned-prepare routes. POST requires the exact HTTPS Origin. Cross-site Fetch Metadata is blocked; CORS is not treated as authentication. Per-remote-host limits are 180 GET and 30 POST requests per minute. These are abuse controls, not wallet authorization; the contract grant and fresh trade checks remain mandatory. Local owner diagnostics and bot routes are disabled in public mode. The browser performs any real send through the injected wallet only after explicit review and confirmation.

Limitations: no production deployment or real-domain smoke has yet been performed; RPC/indexer capacity and regional availability must be checked on the actual host. A VPS credential and approved domain are required to complete that validation.
