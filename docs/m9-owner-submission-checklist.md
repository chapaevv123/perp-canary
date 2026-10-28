# M10 final submission checklist

## Copy-ready links

- Live read-only demo: https://perp-canary.onrender.com/
- GitHub: https://github.com/chapaevv123/perp-canary
- DoraHacks Build page: https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail
- Verified order evidence: https://github.com/chapaevv123/perp-canary/blob/main/docs/evidence/verified-delegated-btc-order.json
- Submission text: https://github.com/chapaevv123/perp-canary/blob/main/docs/submission/dorahacks-submission.md
- Demo script: https://github.com/chapaevv123/perp-canary/blob/main/docs/submission/demo-script.md
- Judge walkthrough: https://github.com/chapaevv123/perp-canary/blob/main/docs/submission/judge-walkthrough.md
- Roadmap, clearly marked as planned: https://github.com/chapaevv123/perp-canary/blob/main/docs/submission/product-roadmap.md

## Owner actions before submission

1. Capture the exact MetaMask warning, URL, extension version and screenshot. Do not bypass a live warning, connect, or sign on the flagged URL. Use the prepared [official review request](submission/metamask-review-request.md); submit it through MetaMask's site-warning channel. Wait for review or independently verify resolution in a normal MetaMask session.
2. In Render, confirm the deployed commit SHA matches GitHub `main` after this documentation update. The public app serves source-matching JavaScript and CSS, but the public health endpoint does not expose the Render deploy SHA. Render Free can cold start after idle; allow time for a judge's first load.
3. Confirm the DoraHacks email whitelist in the existing dreamDEX/Somnia support ticket. The owner previously reported a disabled Submit Build button. Check the authenticated form's exact deadline, timezone, track and required fields; the public page did not establish these reliably.
4. Record a two-minute demo video and product post only if the authenticated form requires them. Their public URLs are pending; do not paste placeholders into the form.
5. Review the claims and links above, then submit the DoraHacks Build manually. No submission has been made by this release task.

The working product is the 21-market Radar, live BTC/ETH data and trusted book, deterministic Guard, guarded PostOnly planning, in-tab Alerts, SDK Journal, sizing estimate and verified historical delegated BTC fill. The AI Copilot, background notifications, full PnL and multi-DEX analytics are roadmap only.
