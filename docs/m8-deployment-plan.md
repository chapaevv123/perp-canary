# M8 deployment plan — preparation only

The repository remote is `https://github.com/chapaevv123/perp-canary.git`, branch `main`. No push or deployment was performed by M8. The application is a Node service with outbound HTTPS and WebSocket needs; static hosting is insufficient. `Dockerfile`, `.dockerignore`, `.env.example` and `fly.example.toml` are prepared but not deployed.

Fly.io is a practical small-machine option with managed HTTPS and outbound networking. Its official [pricing page](https://fly.io/pricing/) lists a shared 1x 256 MB example around **$2.19/month** in one displayed region; [resource pricing](https://fly.io/docs/about/pricing/) varies by region and memory. Start at 512 MB if SDK memory measurements require it. Storage/egress/domain may cost extra. These are estimates, not a purchase authorization. `min_machines_running = 0` keeps idle compute lower but introduces cold starts. A small always-on VPS with HTTPS reverse proxy is another option after operational review.

After owner approval, review the exact changes and use:

```powershell
git status --short
git log -1 --oneline
git push origin main
Copy-Item fly.example.toml fly.toml
# Edit app name and CANARY_PUBLIC_ORIGIN to the approved exact HTTPS host.
fly auth login
fly apps create <approved-app-name>
fly deploy -c fly.toml
fly status -a <approved-app-name>
```

The container binds `0.0.0.0:8080` only when `CANARY_PUBLIC_ENABLED=1` and a valid exact `CANARY_PUBLIC_ORIGIN` is set. Local defaults remain loopback. Health: `GET /api/v1/health`; then test `/api/v1/health/sources?market=BTC-PERP`, market registry, trusted book, history and the read-only UI from the public HTTPS URL. Test rejection of cross-origin POST and unknown routes. Do not enable real trading as a public claim until wallet flow and owner grants are checked on the deployed origin. No secrets belong in `fly.toml`; use the platform's secret mechanism if future configuration needs one.

`npm run build` passed locally. The Docker image could not be built here because Docker Desktop's Linux daemon pipe was absent; run `docker build -t perp-canary:m8-local .` and a local container health smoke on a machine with a running daemon before any approved deployment. The Docker context excludes ignored evidence, keys and the untracked `design/` directory.
