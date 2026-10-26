# Pulse Evolution Bridge — Perp Canary local evidence ledger

| Milestone | Evidence | Техническая компетенция | Promotion |
| --- | --- | --- | --- |
| M2.5 | `trade-evidence/tx-e164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc.json`, SHA-256 `c7277da946c77d9eee6626bc3bf14ac4b54f4205c5c9886620a8b28052026963` | Проверенная on-chain атрибуция исполнения и сверка событий | Нет |
| M2.6, 2026-10-26 | `docs/trading-authorization-audit.md`; `authorization-evidence/authorization-33989411.json` (SHA-256 `d2af8bce3d9079c077c0cecadf62bb7c583a5dcec9bb1a302d626736b8dd97fb`); read-only smoke Hideki blocks 33983631 / 33985056 / 33989411 | Permission registry, различение effective/global/per-pool grant, безопасная симуляция delegated calldata, execution lock | Нет |
| M3.0, 2026-10-26 | `docs/m3-bot-foundation.md`; mock keystore и gate тесты; локальная bot-plan SHA-256 цепочка | Encrypted keystore CLI, Bot Connection, read-only delegated plan, signing/broadcast locks | Нет |
| M3.3, 2026-10-27 | `docs/m3-delegated-execution.md`; 78 mock/fixture tests; LIVE read-only Hideki blocks 34024478 and 34025323 | Owner-confirmed local `placeOrderFor` path, durable intent reservation, receipt forensics and SHA-256 evidence; live `PREPARED` plan construction, no live trade in M3.3 | Нет |
| M3.3.1, 2026-10-27 | `docs/m3-3-1-preflight-diagnosis.md`; saved plan hash `8b5d51f8609d79c527de185294bdbef1baa4e232d5728a3405629596b721cfd0`; read-only book blocks 34030745 and 34034090 | Proven IOC no-fill revert diagnosis; primary error and dependent gates shown without relaxing safety checks | Нет |
| M3.4, 2026-10-27 | `docs/m3-4-lifecycle-demo.md`; mock CANCEL/REDUCE_ORDER lifecycle; LIVE read-only Hideki blocks 34043411 and 34043615 | On-chain order discovery, safe order maintenance plans, shared local execution/forensics, Canary risk explanations; position CLOSE correctly blocked | Нет |

Evolution Score остаётся **26**. Это локальное дополнение к Pulse Evolution Bridge, не самостоятельное решение о продвижении. Promotion Gate не выполнялся. Прочтение SDK и документация не повышают score.
