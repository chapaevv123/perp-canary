# M2.6 — Trading Authorization & Execution Path Audit

Проверено 2026-10-26. Только публичные данные и read-only RPC. Evolution Score: **26**, Promotion Gate не проводился.

## Подтверждённая схема

Официальный [Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) разрешает владельцу Somnia Account связать адрес бота с выбранным Wallet 1/2/3. Бот хранит собственный ключ, подписывает свои транзакции и платит свой STT gas. Позиции, ордера и MarginBank остаются у выбранного торгового кошелька. Права выдаются по конкретному perp-рынку; бот может `placeOrderFor`, `cancelOrderFor`, `reduceOrderFor`, но не может вывести или перевести средства и не может создать exchange TP/SL. Владелец может отозвать доступ в Bots tab; уже выставленные ордера сохраняются. Legacy Account не поддерживает этот маршрут. Создание бота, выдача прав и пополнение gas в M2.6 не выполнялись.

Официальная [страница perps для разработчиков](https://app.testnet.dreamdex.io/docs/developers/perps-testnet) подтверждает Hideki 50383, RPC `https://api.hideki2.infra.testnet.somnia.network`, MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, OperatorPermissionsRegistry `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`, SDK `0.32.1` и ABI `placeOrderFor`. [Контрактная документация](https://app.testnet.dreamdex.io/docs/developers/contracts/functions) определяет `isOperatorAuthorized` как эффективную проверку pool для каждого selector. Значение global grant само по себе не гарантирует доступ к pool. Selector `place` — `0x80054449`, `cancel` — `0xe37b444b`, `reduce` — `0x364c2587` по установленному SDK 0.32.1 и официальным материалам. Права на отмену или уменьшение нельзя выводить из права на размещение.

Прямой путь [Markets SDK](https://prd.smk.somnia.host/docs/typescript/perps) `placePerpOrder` действует от владельца SDK-кошелька и расходует его margin и gas. Для Wallet 1 документирован путь через связанного бота и `placeOrderFor`. В установленном SDK нет готового high-level delegated perp builder; M2.6 кодирует только опубликованный ABI и проверяет его selector. Закрытие позиции возможно противоположным ордером или документированным `reduceOrderFor` при соответствующем разрешении; M2.6 не готовит close, так как текущий планировщик не обеспечивает reduce-only. Ранее открытая позиция не доказывает актуальные права исполнителя.

## M2.5 транзакция

Артефакт [M2.5](../trade-evidence/tx-e164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc.json) и `npm run verify` подтверждают: внешний sender/gas payer `0x71f64cd5e6e05b8401d21dc34a82c5209d1b20f0` вызвал `placeOrderFor` у BTC-PERP pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`; owner — Wallet 1 `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f`. Receipt содержит `OrderPlaced`, `OrderFilled`, `PositionUpdated` и MarginBank события. При LIVE чтении 2026-10-26 блок 33983631: pool указывает на официальный Hideki registry; для этого sender все три эффективных permission read вернули `true`, а также global и per-pool slots `true`. `isOwner(EOA)` на Wallet 1 вернул `false`; это не проверка связи с dreamDEX login. Контроль ключа исторического sender Perp Canary: **UNKNOWN**.

## Матрица путей

| Путь | Owner / collateral | Подпись и gas | Условия и статус M2.6 |
| --- | --- | --- | --- |
| External EOA direct | EOA / его MarginBank | EOA / его STT | SDK поддерживает; EOA не управляет средствами Wallet 1, собственное финансирование и whitelist не подтверждены. **BLOCKED**. |
| Wallet 1 direct | Wallet 1 / его MarginBank | Встроенный dreamDEX signer / gas неизвестен для будущей сделки | Через app возможен; ключ и signing API для Perp Canary не доступны. **BLOCKED**. |
| Официальный delegated bot | Wallet 1 / его MarginBank | Отдельный бот / его STT | Нужен адрес бота под контролем владельца, явный grant для BTC-PERP, gas, margin, свежий preflight и отдельное разрешение на M3. Документирован **SUPPORTED**, фактически **BLOCKED** до выполнения условий. |
| Другой SDK wallet | Новый owner / его MarginBank | Его signer / STT | Прямой SDK путь существует, но отдельное финансирование и конкурсная допустимость **UNKNOWN**. |

По [документации Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) безопаснее выделить отдельный бот и, по возможности, отдельный торговый кошелёк с ограниченной суммой. Использование именно Wallet 1 должно быть отдельным решением владельца. Perp Canary не запрашивает seed/private key и не экспортирует Privy keys.

## Execution prototype

Последовательность M3: `PLAN → PREFLIGHT → USER APPROVAL → SIGN → BROADCAST → RECEIPT → EVENTS → RECONCILIATION → EVIDENCE`. M2.6 реализует только `PLAN`, read-only `PREFLIGHT`, checks и `eth_estimateGas`, а также эфемерное unsigned calldata (IOC, срок 2 минуты) после проверки chain ID, market row, factory, feed, system wiring, registry, effective grant, tick/lot, margin preview, SDK maximum placeable size и gas. Даже при успешной симуляции статус остаётся **BLOCKED**: приложения не имеют signer и broadcast. Предыдущая кнопка `eth_sendTransaction` удалена. Доступность whitelist и контроль адреса бота не выводятся из on-chain permissions.

LIVE smoke при блоке 33985056: исторический sender имеет 0.669714892 STT; Wallet 1 имеет 1000 USDso unlocked в MarginBank на момент чтения; `placeOrderFor` для BTC-PERP с 0.001 BTC по лимиту 80440.4 прошёл проверки SDK market/feed/max-size и `eth_estimateGas`. Это не прогноз исполнения, не актуальный ордер и не доказательство владения signer. Балансы и права могут измениться.

Повторный LIVE smoke 2026-10-26 на блоке 33989411 сохранён в [`authorization-evidence/authorization-33989411.json`](../authorization-evidence/authorization-33989411.json), SHA-256 `d2af8bce3d9079c077c0cecadf62bb7c583a5dcec9bb1a302d626736b8dd97fb`. Для исторического sender все три effective grant были `true`, registry совпал, MarginBank показывал 1000 USDso unlocked, а `eth_estimateGas` прошёл для того же прототипа. Артефакт фиксирует состояние в момент чтения; время sample используется для ограничения свежести preflight. Владелец ключа исторического sender остаётся неизвестным.

[Правила paper USDso](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/margin-and-liquidations): кредит нельзя вывести, пока он находится в Perps account; открыть или увеличить позицию разрешено только на рынках из allowlist, при этом сокращение и закрытие допустимы; leverage нельзя менять, пока кредит остаётся на счёте, builder fee не взимается. SDK `getMaxPerpOrderSize` сообщает `voucherBlocked`, когда кредит запрещает увеличение. Отмена требует проверки живого `orderId` и отдельного `cancelOrderFor` grant; истёкший ордер нельзя сократить через `reduceOrderFor`. Для закрытия нужно проверить фактическую позицию и направление непосредственно перед новым reduce-only планом. Текущий M2.6 не создаёт cancel/close calldata и ничего не подписывает.

## Bounty readiness

[Страница события DoraHacks на Eventbrite](https://www.eventbrite.com/e/dreamdex-perps-builder-bounty-tickets-2003605109819?aff=ebdssbdestsearch), проверена 2026-10-26: указано онлайн-событие 19 октября — 2 ноября 2026, регистрация открыта всем, но Builds могут отправлять только адреса email из whitelist. Для добавления предлагается ticket в dreamDEX Discord либо SomniaHacks Telegram с DoraHacks email. Это расписание события, **не подтверждённый точный deadline submission**. [Основная страница bounty на DoraHacks](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) при проверке вернула HTTP 405. Точные требования к submission, критерии оценки, необходимость собственного trading UI и достаточность read-only execution verification: **UNKNOWN**. Никакая заявка не отправлялась.

Дата окончания [Perps Arena](https://app.testnet.dreamdex.io/competition) — 9 ноября 2026 — относится к отдельной торговой акции и не является дедлайном Builder Bounty.

**Решение: NO-GO для M3 broadcast сейчас.** Владелец должен отдельно выбрать контролируемый публичный bot address, связать его в dreamDEX с конкретным wallet/рынком, подтвердить gas и margin, проверить whitelist и конкурсные условия, затем явно разрешить отдельную реализацию signer/broadcast и конкретную тестовую сделку. До этого доступны только чтение и симуляция.
