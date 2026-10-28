# M9 production acceptance — 2026-10-28

| Check | State | Evidence / remaining limit |
| --- | --- | --- |
| GitHub push | VERIFIED | Public `main` remote SHA `061bd186043742bda60ab7aa5a8b8f1154f8355c`; README API read succeeded. |
| Secret review | VERIFIED within repository scan | No tracked `.env`, PEM/key, database or log files; PEM/mnemonic searches found no private material. Public testnet wallet addresses and transaction hashes remain in intentional proof artifacts. `design/` stays untracked. |
| Durable production host | BLOCKED | No authenticated suitable hosting account was available. Render Free Docker blueprint prepared; production URL, build and uptime unverified. |
| Temporary public HTTPS | VERIFIED PREVIEW | Cloudflare Quick Tunnel URL tested; no uptime guarantee or stable hostname. It is not a production release URL. |
| HTTPS, health, static assets | VERIFIED PREVIEW | Chromium and HTTPS GET; health 200, HSTS present, app modules loaded. |
| Market discovery and switching | VERIFIED PREVIEW | 21 supported PERPs, BTC and ETH selected, trusted books displayed. |
| Real candles and order book | VERIFIED PREVIEW | BTC showed 120 real indexed candles and trusted pinned on-chain bid/ask; ETH book trusted. Data can degrade with external sources. |
| Market Radar | VERIFIED PREVIEW | 21/21 snapshots; 19 current scores; missing/stale data kept unscored. |
| Canary Guard / PostOnly | VERIFIED LOCAL, VISIBLE PREVIEW | Guard NOT READY and maker-only controls visible; full wallet preflight on a public origin requires owner wallet verification. No order was submitted. |
| Position Sizing | VERIFIED LOCAL, VISIBLE PREVIEW | BTC/ETH/ADA precision regression and explicit quantity transfer passed locally; public page includes the control. No protective stop is installed. |
| Alerts | VERIFIED PREVIEW | Create, persistence after reload, delete; only works while the browser tab is open. |
| Journal / Replay | VERIFIED PREVIEW WITH READ-ONLY IDENTITY | Three actual indexed Wallet 1 orders; verified Canary replay linked. The browser test supplied a read-only public address, not a connected wallet. |
| Mobile | VERIFIED PREVIEW | Chromium 390px viewport with 390px document width. Firefox public smoke remains unrun. |
| API protections | VERIFIED PREVIEW | Cross-origin POST 403, prohibited route 403, HSTS/CSP present. Repeat on durable domain. |
| Multi-user storage | VERIFIED DESIGN LIMIT | No shared server alert database; alert rules are browser-local per account scope. Shared browser profiles are outside tenant isolation. |
| Production and DoraHacks | BLOCKED | Durable $0 host access, deployed URL, public-domain acceptance, confirmed whitelist and separate submission authorization remain. |

Preview screenshots: [terminal](screenshots/m9-public-preview-terminal.png), [Radar](screenshots/m9-public-preview-radar.png), [Journal](screenshots/m9-public-preview-journal.png), [mobile](screenshots/m9-public-preview-mobile.png). All were captured from the temporary public HTTPS endpoint and use real market reads; the Journal browser identity was read-only injected.
