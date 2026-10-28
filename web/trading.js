/* EIP-1193 direct and owner-delegated flows. The server only reads and prepares unsigned calls. */
import { compareDelegatedCancel, comparePreflight } from './preflight-compare.js';
import { priceScenario } from './position-scenario.js';
import { explainGuard } from './guard-v2.js';
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { provider: null, account: null, chainId: null, accountData: null, mode: 'DIRECT',
    side: 'BUY', market: null, plan: null, busy: false, pendingHash: null, pendingAccount: null,
    pendingMarket: null, pendingMode: null, pendingData: null,
    requestId: 0, fundingRequestId: 0, historyRequestId: 0, marketRegistry: [],
    funding: null, voucherPlan: null, voucherPending: null, positionRequestId: 0, positionMetrics: null };
  const expectedMetaMask = '0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42';
  const embeddedAccount = '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f';
  const panel = document.querySelector('.trade-panel');
  panel.querySelector('.eyebrow').textContent = 'DIRECT WALLET TRADING';
  panel.querySelector('h2').textContent = 'Trade BTC-PERP';
  panel.querySelector('.badge').textContent = 'WALLET APPROVAL';
  panel.querySelector('.trade-callout strong').textContent = 'Every order requires your wallet confirmation.';
  panel.querySelector('.trade-callout span').textContent =
    'Perp Canary prepares and simulates a direct pool call. Your connected wallet signs and sends it only after review.';
  document.querySelector('.chart-panel .eyebrow').textContent = 'REAL MARKET HISTORY · SDK INDEXER';
  $('bot-pill').textContent = 'POOL · CHECKING';
  const feeFacts = document.createElement('div'); feeFacts.innerHTML =
    '<span>Builder fee</span><strong>0 bps in calldata</strong>';
  panel.querySelector('.trade-facts').append(feeFacts);
  const feeNote = document.createElement('p'); feeNote.className = 'small';
  feeNote.textContent = 'Exchange and funding fees are not quoted here. Review dreamDEX terms before trading.';
  panel.querySelector('.trade-facts').after(feeNote);
  $('sell').title = 'SELL PostOnly can open or add to a short; this is not reduce-only.';
  $('use-ask').title = 'Available for SELL PostOnly. For BUY it would cross the book.';
  $('copy-prepare').textContent = 'Copy separate owner CLI command';
  $('copy-prepare').classList.remove('primary');
  $('copy-prepare').classList.add('secondary');
  const workflow = document.createElement('div'); workflow.className = 'wallet-workflow';
  workflow.innerHTML = `
    <div class="account-mode" role="group" aria-label="Trading account">
      <button id="mode-delegated" type="button" class="mode-button" aria-pressed="false">Delegated Perps<span>Wallet 1 margin · MetaMask gas</span></button>
      <button id="mode-direct" type="button" class="mode-button active" aria-pressed="true">Direct Wallet<span>Connected EOA margin</span></button>
    </div><p id="mode-explanation" class="mode-explanation">Direct Wallet uses only the connected EOA's margin. Choose Delegated Perps for Wallet 1 after a verified Link a Bot grant.</p>
    <div class="wallet-summary"><strong id="wallet-state">Connect an EIP-1193 wallet to trade directly.</strong>
      <span id="wallet-balances">Wallet balance and MarginBank: not read</span><span id="wallet-permissions">Trading permissions: checking after wallet connection.</span></div>
    <div class="radar-card"><span>CANARY MARKET RADAR</span><strong id="radar-state">UNKNOWN</strong>
      <p id="radar-details">Waiting for independently checked live data.</p>
      <p id="radar-monitoring">In-tab monitoring active while this page remains open.</p>
      <div id="radar-alerts"></div></div>
    <div class="guard-card"><span>CANARY TRADE GUARD</span><strong id="guard-verdict">AWAITING REVIEW</strong><b id="guard-decision">UNAVAILABLE</b>
      <p id="guard-explanation">Enter an order and review it to run fresh book, account, margin, gas and contract checks.</p>
      <label class="guard-setting">Spread caution above <select id="guard-spread"><option value="10">10 bps</option><option value="25" selected>25 bps</option><option value="50">50 bps</option><option value="100">100 bps</option></select></label>
      <div id="guard-checks" class="guard-checks" aria-live="polite"></div></div>
    <button id="review-order" class="button primary full" type="button" disabled>Review wallet order</button>
    <div id="trade-review" class="review-card" hidden>
      <h3>Review direct BTC-PERP order</h3><p id="review-details"></p>
      <p id="review-risk"></p><p id="review-contract"></p><code id="review-calldata"></code>
      <div class="review-actions"><button id="confirm-wallet" class="button primary" type="button">Confirm in wallet</button>
        <button id="dismiss-review" class="button secondary" type="button">Edit order</button></div>
    </div><p id="wallet-result" class="wallet-result" role="status" aria-live="polite"></p>
    <div id="preflight-details" class="preflight-details" role="status" aria-live="polite" hidden></div>
    <div class="sizing-card"><strong>Smart position sizing</strong>
      <p>Reference calculation only. A stop reference does not install a stop order.</p>
      <div class="sizing-fields"><label>Capital (USDso)<input id="size-capital" type="text" inputmode="decimal" placeholder="100"></label>
        <label>Risk (%)<input id="size-risk" type="text" inputmode="decimal" placeholder="1"></label>
        <label>Or absolute risk budget (USDso)<input id="size-absolute-risk" type="text" inputmode="decimal" placeholder="Optional; overrides percent"></label>
        <label>Stop reference<input id="size-stop" type="text" inputmode="decimal" placeholder="Price"></label></div>
      <button id="calculate-size" class="button secondary full" type="button">Calculate from current entry</button>
      <p id="size-result" role="status" aria-live="polite">Enter capital, risk, a limit entry and stop reference.</p>
      <button id="use-sized-quantity" class="button secondary full" type="button" disabled>Use calculated quantity</button></div>
    <div class="wallet-position"><strong id="position-heading">Your selected-market account</strong><p id="wallet-position">Connect a wallet to read your own position and open orders.</p>
      <div id="wallet-orders"></div><div class="position-intelligence"><div class="section-line"><strong>Position intelligence</strong><button id="refresh-position-intelligence" type="button" class="button secondary">Refresh metrics</button></div>
      <p id="position-intelligence-status" role="status">Connect a wallet to read a pinned on-chain position snapshot.</p>
      <dl class="position-metrics"><div><dt>Direction / size</dt><dd id="metric-direction">—</dd></div><div><dt>Entry / mark</dt><dd id="metric-prices">—</dd></div>
      <div><dt>Unrealized PnL</dt><dd id="metric-upnl">Unavailable</dd></div><div><dt>Funding owed</dt><dd id="metric-funding">Unavailable</dd></div>
      <div><dt>Liquidation reference</dt><dd id="metric-liquidation">Unavailable</dd></div><div><dt>Realized PnL</dt><dd id="metric-realized">Unavailable</dd></div></dl>
      <label class="scenario-label">If mark price changes by <output id="scenario-percent">0%</output><input id="scenario-slider" type="range" min="-30" max="30" value="0" step="1" disabled></label>
      <p id="scenario-result">Scenario unavailable until a position and fresh mark are read.</p><p class="small">Price-only estimate against entry. It excludes future funding, fees, liquidation and position changes. SDK metrics use one block; refresh before a decision.</p></div></div>
    <div class="wallet-actions"><strong>Manage margin and orders</strong>
      <p>Each action has its own simulation, review and wallet confirmation. Approval is bounded to the entered amount.</p>
      <label>Action <select id="wallet-action"><option value="APPROVE">Approve exact USDso</option>
        <option value="DEPOSIT">Deposit margin</option><option value="WITHDRAW">Withdraw free margin</option>
        <option value="CANCEL">Cancel selected order</option></select></label>
      <label>Amount (USDso) <input id="action-amount" type="text" inputmode="decimal" placeholder="10"></label>
      <label id="action-order-label" hidden>Selected order ID <input id="action-order-id" type="text" readonly></label>
      <button id="review-action" class="button secondary full" type="button" disabled>Review wallet action</button>
      <div id="action-review" class="review-card" hidden><h3>Review wallet action</h3>
        <p id="action-details"></p><p id="action-contract"></p>
        <div class="review-actions"><button id="confirm-action" class="button primary" type="button">Confirm in wallet</button>
          <button id="dismiss-action" class="button secondary" type="button">Edit action</button></div></div>
      <p id="action-result" class="wallet-result" role="status" aria-live="polite"></p></div>
    <div class="wallet-journal"><strong>Trade Review</strong>
      <p id="trade-review-summary">Awaiting a wallet transaction receipt. Placement, current open state and fills are separate facts.</p>
      <strong>Recent browser transactions</strong>
      <p>Local public transaction references; states come from independently read receipts and open orders.</p>
      <div id="journal-entries">No wallet transactions from this browser session.</div>
      <strong>Order History · SDK indexer</strong><p>Finished orders for the selected account and market. Indexer rows may lag current on-chain state.</p>
      <button id="load-order-history" class="button secondary" type="button">Load order history</button>
      <p id="history-status" role="status">History not requested.</p><div id="history-rows"></div>
      <p id="verified-trade-note" class="small" hidden>Verified historical delegated BTC order: #14978756187852164141712, BUY 0.00013 BTC at 80880 USDso, fully filled in block 34790084. This is prior evidence, not a current quote or open order. Confirm current state with Load order history.</p></div>
    <div class="wallet-journal"><strong>Canary AI Copilot</strong>
      <p>Unavailable: no model service is connected. Guard, Radar and sizing use disclosed deterministic checks; they do not generate AI advice.</p></div>`;
  panel.querySelector('.trade-facts').before(workflow);
  for (const selector of ['.account-mode', '.mode-explanation', '.wallet-summary'])
    panel.querySelector('.side-switch').before(workflow.querySelector(selector));
  const compactAccount = document.createElement('div'); compactAccount.className = 'compact-account';
  compactAccount.innerHTML = '<strong id="compact-account-name">Connect wallet</strong><span id="compact-account-mode">Direct Wallet</span><span id="compact-account-market">BTC-PERP</span><b id="compact-permission">Permission: Not checked</b>';
  const permissionDetails = document.createElement('details'); permissionDetails.id = 'wallet-permission-details';
  permissionDetails.className = 'wallet-permission-details';
  permissionDetails.innerHTML = '<summary>Wallet & permissions</summary><dl class="permission-facts"><div><dt>Connected EOA</dt><dd id="permission-eoa">Not connected</dd></div><div><dt>Margin owner</dt><dd id="permission-owner">Not connected</dd></div><div><dt>Chain</dt><dd id="permission-chain">Not checked</dd></div><div><dt>Operator gas</dt><dd id="permission-gas">Not read</dd></div><div><dt>Free margin</dt><dd id="permission-margin">Not read</dd></div><div><dt>Selected pool grant</dt><dd id="permission-grant">Not checked</dd></div><div><dt>Evidence</dt><dd id="permission-evidence">Awaiting on-chain account read</dd></div><div><dt>Last refresh</dt><dd id="permission-refreshed">Not read</dd></div></dl>';
  permissionDetails.append($('mode-explanation'), $('wallet-summary'));
  const walletWarning = document.createElement('p'); walletWarning.id = 'wallet-warning';
  walletWarning.className = 'wallet-warning'; walletWarning.hidden = true;
  panel.querySelector('.side-switch').before(compactAccount, walletWarning, permissionDetails);
  const guardDetails = document.createElement('details'); guardDetails.id = 'guard-check-details';
  guardDetails.innerHTML = '<summary>View detailed checks</summary>';
  $('guard-checks').before(guardDetails); guardDetails.append($('guard-checks'));
  const accountDesk = document.createElement('section');
  accountDesk.className = 'account-desk'; accountDesk.setAttribute('aria-label', 'Account workspace');
  const walletOrders = workflow.querySelector('#wallet-orders');
  const tabs = document.createElement('div'); tabs.className = 'account-tabs';
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Account workspace sections');
  const panes = [
    ['positions', 'Positions', workflow.querySelector('.wallet-position')],
    ['orders', 'Open Orders', document.createElement('section')],
    ['history', 'Order History', document.createElement('section')],
    ['trades', 'Trade History', document.createElement('section')],
    ['balances', 'Balances / Margin', workflow.querySelector('.wallet-actions')],
    ['replay', 'Execution Replay', document.createElement('section')],
  ];
  const byName = new Map();
  for (const [name, label, pane] of panes) {
    pane.id = `account-tab-${name}`; pane.classList.add('account-tab-panel');
    pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', `account-tab-button-${name}`);
    const button = document.createElement('button'); button.id = `account-tab-button-${name}`;
    button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', pane.id);
    button.textContent = label; tabs.append(button); accountDesk.append(pane); byName.set(name, { button, pane });
  }
  function activateTab(name, focus = false) {
    for (const [key, { button, pane }] of byName) {
      const active = key === name;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      pane.hidden = !active;
    }
    if (focus) byName.get(name)?.button.focus();
  }
  for (const [name, { button }] of byName) button.onclick = () => activateTab(name);
  tabs.onkeydown = event => {
    const keys = [...byName.keys()], current = keys.findIndex(name => byName.get(name).button === document.activeElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); activateTab(keys[(current + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], true);
    } else if (event.key === 'Home') { event.preventDefault(); activateTab(keys[0], true); }
    else if (event.key === 'End') { event.preventDefault(); activateTab(keys.at(-1), true); }
  };
  accountDesk.prepend(tabs);
  const ordersPane = byName.get('orders').pane;
  ordersPane.innerHTML = '<h3>Live open orders</h3><p>Only orders on the selected account and market are shown. Cancel requires a separate fresh review and wallet confirmation.</p>';
  ordersPane.append(walletOrders);
  const positionsPane = byName.get('positions').pane;
  const positionTable = document.createElement('div'); positionTable.className = 'position-table-wrap';
  positionTable.innerHTML = '<table class="position-table"><thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Unrealized PnL</th><th>Funding owed</th><th>Free margin</th><th>Liq. reference</th></tr></thead><tbody><tr><td id="position-table-market">BTC-PERP</td><td id="position-table-side">—</td><td id="position-table-size">—</td><td id="position-table-entry">—</td><td id="position-table-mark">—</td><td id="position-table-pnl">—</td><td id="position-table-funding">—</td><td id="position-table-margin">—</td><td id="position-table-liquidation">—</td></tr></tbody></table>';
  positionsPane.querySelector('#wallet-position').after(positionTable);
  const advancedPosition = document.createElement('details'); advancedPosition.className = 'position-advanced';
  advancedPosition.innerHTML = '<summary>Position intelligence, full evidence & price scenario</summary>';
  advancedPosition.append(positionsPane.querySelector('.position-intelligence'));
  positionTable.after(advancedPosition);
  const attribution = document.createElement('p'); attribution.className = 'position-attribution';
  attribution.textContent = 'Current wallet position is separate from historical Canary execution. Only the verified 0.00013 BTC increment belongs to that BTC order. Scenario values are estimates.';
  advancedPosition.after(attribution);
  const journal = workflow.querySelector('.wallet-journal');
  const historyPane = byName.get('history').pane;
  historyPane.innerHTML = '<h3>Finished orders · SDK indexer</h3><p>Indexer history can lag the current on-chain order state.</p>';
  for (const id of ['load-order-history', 'history-status', 'history-rows', 'verified-trade-note']) historyPane.append($(id));
  const tradesPane = byName.get('trades').pane;
  tradesPane.innerHTML = '<h3>Browser transaction references</h3><p>Receipts and current order status are separate facts. This list records only transactions initiated by this browser session.</p>';
  for (const id of ['trade-review-summary', 'journal-entries']) tradesPane.append($(id));
  journal.remove();
  const replayPane = byName.get('replay').pane;
  replayPane.innerHTML = '<h3>Verified historical BTC execution</h3><p>Order #14978756187852164141712 placed and fully filled. Only its 0.00013 BTC increment is attributed to this execution; no historical preflight was recorded.</p><button id="account-open-replay" type="button" class="button secondary">Open verified replay</button>';
  replayPane.querySelector('#account-open-replay').onclick = () => document.querySelector('.replay-trigger')?.click();
  const tools = document.createElement('details'); tools.className = 'account-tools';
  tools.innerHTML = '<summary>Canary Radar and position sizing</summary>';
  tools.append(workflow.querySelector('.radar-card'), workflow.querySelector('.sizing-card'));
  accountDesk.append(tools);
  activateTab('positions');
  const mainGrid = document.querySelector('.main-grid');
  mainGrid.append(accountDesk);
  const diagnostics = document.createElement('section');
  diagnostics.className = 'diagnostic-dock'; diagnostics.setAttribute('aria-label', 'Historical owner diagnostics');
  for (const id of ['risk', 'portfolio', 'proof']) diagnostics.append($(id));
  mainGrid.after(diagnostics);
  const unavailableCopilot = workflow.querySelector('.wallet-journal');
  if (unavailableCopilot) unavailableCopilot.remove();
  const status = (message, kind = '') => { $('wallet-result').textContent = message; $('wallet-result').dataset.kind = kind; };
  const actionStatus = (message, kind = '') => { $('action-result').textContent = message;
    $('action-result').dataset.kind = kind; };
  const text = (id, value) => { $(id).textContent = value; };
  const displayNumber = (value, digits = 6) => value == null || value === '' ? 'Unavailable' : Number.isFinite(Number(value)) ?
    Number(value).toLocaleString('en-US', { maximumFractionDigits: digits }) : String(value);
  function positionCell(id, value, digits = 6) {
    const node = $(id);
    node.textContent = value == null ? 'Unavailable' : displayNumber(value, digits);
    node.title = value == null ? 'This metric is unavailable from the current SDK snapshot' : String(value);
  }
  function renderGuardV2(plan, draft) {
    const report = explainGuard(plan, draft, Number($('guard-spread').value));
    text('guard-decision', report.decision);
    $('guard-decision').dataset.state = report.decision;
    text('guard-explanation', `${report.nextAction} ${report.blockers?.join(' ') || ''}`.trim());
    $('guard-checks').replaceChildren(...report.checks.map(check => {
      const row = document.createElement('div'); row.className = 'guard-check';
      const name = document.createElement('strong'); name.textContent = `${check.name} · ${check.status}`;
      const detail = document.createElement('span'); detail.textContent = check.observed;
      const rule = document.createElement('small'); rule.textContent = `${check.rule} · block ${check.freshness}`;
      row.append(name, detail, rule); return row;
    }));
    return report;
  }
  function idleGuard() {
    const quantity = $('quantity').value.trim(), price = $('limit-price').value.trim();
    const error = $('trade-error').textContent.trim();
    let decision, explanation;
    if (!quantity || !price) {
      decision = 'NOT READY'; explanation = !quantity && !price ?
        'Enter a quantity and a valid PostOnly limit price to review this order.' :
        !quantity ? 'Enter a valid quantity to review this order.' : 'Enter a valid limit price to review this order.';
    } else if (!connected()) {
      decision = 'NOT READY'; explanation = state.account ? 'Switch wallet to Somnia Hideki 50383.' : 'Connect a wallet to review this order.';
    } else if (/fresh TRUSTED quote/i.test(error)) {
      decision = 'UNAVAILABLE'; explanation = 'A fresh trusted book is required. Refresh the selected market and try again.';
    } else if (!$('trade-error').classList.contains('okay')) {
      decision = 'BLOCKED'; explanation = error || 'Correct the order parameters before review.';
    } else {
      decision = 'READY FOR REVIEW'; explanation = 'Inputs are valid. Review will check current permissions, margin, gas and contract simulation.';
    }
    text('guard-verdict', decision === 'NOT READY' ? 'INPUTS' : decision === 'READY FOR REVIEW' ? 'PREFLIGHT PENDING' : decision);
    $('guard-verdict').dataset.verdict = decision.replaceAll(' ', '_');
    text('guard-decision', decision);
    $('guard-decision').dataset.state = decision;
    text('guard-explanation', explanation);
    $('guard-checks').replaceChildren(); guardDetails.open = false;
    $('review-order').disabled = decision !== 'READY FOR REVIEW' || state.busy || !!state.pendingHash || !!state.actionPending;
    $('review-order').title = $('review-order').disabled ? explanation : 'Run fresh Canary Guard checks and contract simulation; no transaction is sent.';
  }
  $('guard-spread').onchange = () => { if (state.plan) renderGuardV2(state.plan.result, state.plan.input); };
  const validChain = () => state.chainId === 50383;
  const connected = () => !!state.account && validChain();
  const delegated = () => state.mode === 'DELEGATED_PERPS';
  function accountSummary(data = null) {
    text('compact-account-name', delegated() ? 'Wallet 1' : state.account ? 'Direct wallet' : 'Connect wallet');
    text('compact-account-mode', delegated() ? 'Delegated Perps' : 'Direct Wallet');
    text('compact-account-market', $('market-select').value);
    const verified = data && data.market === $('market-select').value &&
      data.account?.toLowerCase() === state.account?.toLowerCase();
    const permission = !connected() ? 'Not ready' : !verified ? 'Checking' :
      delegated() ? data.permissions?.place ? 'Active' : 'Blocked' : 'Direct wallet';
    text('compact-permission', `Permission: ${permission}`);
    $('compact-permission').dataset.state = permission.toLowerCase().replace(' ', '-');
    text('permission-eoa', state.account ?? 'Not connected');
    text('permission-owner', verified ? data.owner ?? state.account : 'Not verified');
    text('permission-chain', validChain() ? 'Somnia Hideki · 50383' : state.account ? 'Wrong network' : 'Not connected');
    text('permission-gas', verified ? `${displayNumber(data.gasStt)} STT` : 'Not read');
    text('permission-margin', verified ? `${displayNumber(data.marginUnlocked)} USDso` : 'Not read');
    text('permission-grant', verified ? delegated() ?
      `Place ${data.permissions?.place ? 'ACTIVE' : 'BLOCKED'} · Cancel ${data.permissions?.cancel ? 'ACTIVE' : 'BLOCKED'} · ${data.permissions?.scope ?? 'selected pool'}` :
      'Operator grant not required for direct EOA' : 'Not checked for selected market');
    text('permission-evidence', verified ? `Official SDK / on-chain account and selected pool · block ${data.block}` : 'Awaiting on-chain account read');
    text('permission-refreshed', verified ? new Date().toLocaleTimeString() : 'Not read');
    const warning = !state.account ? 'Connect a wallet to review an order.' : !validChain() ?
      'Switch wallet to Somnia Hideki 50383.' : verified && delegated() && !data.permissions?.place ?
        'Placement permission is blocked for this market. Review Wallet & permissions.' :
        verified && Number(data.gasStt) <= 0 ? 'Operator gas balance is empty. Add STT before review.' : '';
    walletWarning.hidden = !warning;
    walletWarning.textContent = warning;
  }
  const prepareUrl = () => delegated() ? '/api/v1/trade/delegated/prepare' : '/api/v1/trade/prepare';
  const receiptUrl = mode => mode === 'DELEGATED_PERPS' ? '/api/v1/trade/delegated/receipt' : '/api/v1/trade/receipt';
  const actionReceiptUrl = entry => entry.mode === 'DELEGATED_PERPS' ?
    `/api/v1/trade/delegated/receipt?hash=${encodeURIComponent(entry.hash)}&account=${encodeURIComponent(entry.account)}&market=${encodeURIComponent(entry.market)}&action=CANCEL&orderId=${encodeURIComponent(entry.orderId)}&expectedData=${encodeURIComponent(entry.data)}` :
    `/api/v1/trade/action/receipt?hash=${encodeURIComponent(entry.hash)}&account=${encodeURIComponent(entry.account)}&market=${encodeURIComponent(entry.market)}&action=${entry.action}&orderId=${encodeURIComponent(entry.orderId)}&amount=${encodeURIComponent(entry.amount)}`;
  const journalKey = 'perp-canary/trade-journal/v1';
  function readJournal() { try { const rows = JSON.parse(window.localStorage.getItem(journalKey) || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.hash === 'string').slice(0, 100) : []; }
  catch { return []; } }
  function renderJournal() {
    const rows = readJournal().filter(row => typeof row.account === 'string' &&
      (!state.account || row.account.toLowerCase() === state.account.toLowerCase()));
    const elements = rows.slice(0, 12).map(row => {
      const div = document.createElement('div'); div.className = 'journal-entry';
      div.textContent = `${row.market} · ${row.action} · ${row.state} · ${row.hash.slice(0, 12)}… · ${new Date(row.at).toLocaleString()}${row.orderId ? ` · #${row.orderId}` : ''}`;
      div.title = `${row.hash} · source ${row.source ?? 'WALLET_SUBMISSION'}`;
      return div;
    });
    $('journal-entries').replaceChildren(...elements);
    if (!elements.length) text('journal-entries', 'No wallet transactions recorded in this browser.');
    const latestPlace = rows.find(row => row.action === 'PLACE');
    if (latestPlace) text('trade-review-summary', `${latestPlace.market} ${latestPlace.side} ${latestPlace.quantity} @ ${latestPlace.price} USDso: ${latestPlace.state}. ${
      latestPlace.orderId ? `Order #${latestPlace.orderId}. ` : ''}${
      latestPlace.outcomeAtPlacement === 'RESTED_AT_PLACEMENT' ? 'Receipt observed a rest event at placement. ' : ''}
      Current fill and PnL require separate on-chain evidence.`);
  }
  function recordJournal(hash, update) {
    const rows = readJournal();
    const existing = rows.find(row => row.hash.toLowerCase() === hash.toLowerCase());
    if (existing) Object.assign(existing, update);
    else rows.unshift({ hash, account: update.account, market: update.market,
      action: update.action, state: 'SUBMITTED', at: new Date().toISOString(), source: 'WALLET_SUBMISSION', ...update });
    try { window.localStorage.setItem(journalKey, JSON.stringify(rows.slice(0, 100))); } catch { /* optional local persistence */ }
    renderJournal();
  }
  const request = async (url, options) => {
    const controller = new window.AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
      const body = await response.json();
      if (!response.ok) { const error = Error(body.error || `HTTP ${response.status}`);
        error.code = body.code; error.readBlock = body.readBlock; throw error; }
      return body;
    } finally { window.clearTimeout(timer); }
  };
  function clearPositionIntelligence(message) {
    state.positionMetrics = null;
    text('position-table-market', $('market-select').value);
    for (const id of ['position-table-side', 'position-table-size', 'position-table-entry',
      'position-table-mark', 'position-table-pnl', 'position-table-funding',
      'position-table-margin', 'position-table-liquidation']) positionCell(id, null);
    $('position-table-pnl').className = '';
    text('position-intelligence-status', message);
    for (const id of ['metric-direction', 'metric-prices']) text(id, '—');
    for (const id of ['metric-upnl', 'metric-funding', 'metric-liquidation', 'metric-realized'])
      text(id, 'Unavailable');
    $('scenario-slider').disabled = true;
    text('scenario-result', 'Scenario unavailable until a position and current mark are read.');
  }
  function renderScenario() {
    const percent = Number($('scenario-slider').value);
    text('scenario-percent', `${percent > 0 ? '+' : ''}${percent}%`);
    if (!state.positionMetrics?.scenarioInputs) return;
    try {
      const result = priceScenario(state.positionMetrics.scenarioInputs, percent);
      text('scenario-result', `At approximately ${displayNumber(result.targetPrice, 4)} USDso: estimated position PnL ${displayNumber(result.estimatedPnlUsdso)} USDso. Price-only scenario, not an execution or liquidation forecast.`);
    } catch (error) { text('scenario-result', error.message); }
  }
  async function loadPositionIntelligence() {
    if (!connected()) { clearPositionIntelligence('Connect on Somnia Hideki to read position metrics.'); return; }
    const id = ++state.positionRequestId, account = state.account, mode = state.mode;
    const market = $('market-select').value;
    clearPositionIntelligence('Reading one-block SDK position, mark and margin…');
    try {
      const data = await request(`/api/v1/position/intelligence?account=${encodeURIComponent(account)}&mode=${encodeURIComponent(mode)}&market=${encodeURIComponent(market)}`);
      if (id !== state.positionRequestId || account !== state.account || mode !== state.mode ||
        market !== $('market-select').value) return;
      state.positionMetrics = data;
      text('position-table-market', market);
      text('position-table-side', data.direction);
      positionCell('position-table-size', data.size, 8);
      positionCell('position-table-entry', data.entryPrice, 4);
      positionCell('position-table-mark', data.markPrice, 4);
      positionCell('position-table-pnl', data.unrealizedPnlUsdso);
      $('position-table-pnl').className = data.unrealizedPnlUsdso == null ? '' :
        Number(data.unrealizedPnlUsdso) >= 0 ? 'positive' : 'negative';
      positionCell('position-table-funding', data.accruedFundingOwedUsdso);
      positionCell('position-table-margin', data.availableMarginUsdso);
      positionCell('position-table-liquidation', data.liquidationPrice, 4);
      text('position-intelligence-status', `${data.source} · block ${data.block} · ${new Date(data.observedAt).toLocaleTimeString()}. Free margin ${displayNumber(data.availableMarginUsdso)} USDso (display rounded).`);
      text('metric-direction', `${data.direction} ${displayNumber(data.size, 8)} ${market.replace('-PERP', '')}`);
      text('metric-prices', data.entryPrice && data.markPrice ? `${displayNumber(data.entryPrice, 4)} / ${displayNumber(data.markPrice, 4)} USDso` : 'Unavailable: no priced position');
      text('metric-upnl', data.unrealizedPnlUsdso === null ? `Unavailable: ${data.metricsReason ?? 'no position'}` : `${displayNumber(data.unrealizedPnlUsdso)} USDso`);
      text('metric-funding', data.accruedFundingOwedUsdso === null ? 'Unavailable' : `${displayNumber(data.accruedFundingOwedUsdso)} USDso owed since entry`);
      text('metric-liquidation', data.liquidationPrice === null ? `Unavailable: ${data.liquidationReason}` : `${displayNumber(data.liquidationPrice, 4)} USDso · one-market estimate`);
      text('metric-realized', `Unavailable: ${data.realizedPnlReason}`);
      $('scenario-slider').disabled = !data.scenarioInputs;
      renderScenario();
    } catch (error) { if (id === state.positionRequestId) clearPositionIntelligence(`Position metrics unavailable: ${error.message}. Retry when Hideki RPC responds.`); }
  }
  $('scenario-slider').addEventListener('input', renderScenario);
  $('refresh-position-intelligence').onclick = loadPositionIntelligence;
  function input() { return { account: state.account, market: $('market-select').value,
    side: state.side, orderType: 'POST_ONLY',
    price: $('limit-price').value.trim(), quantity: $('quantity').value.trim(),
    ...(delegated() ? { mode: 'DELEGATED_PERPS', owner: embeddedAccount } : {}) }; }
  function switchMode(mode) {
    if (state.busy || state.pendingHash || state.actionPending) {
      status('Finish or refresh the pending wallet transaction before switching accounts.', 'warn'); return;
    }
    state.mode = mode; state.accountData = null; state.requestId++;
    accountSummary();
    state.positionRequestId++; state.positionMetrics = null;
    state.historyRequestId++; $('history-rows').replaceChildren();
    text('history-status', 'History not requested for this account mode.');
    $('mode-direct').classList.toggle('active', !delegated());
    $('mode-delegated').classList.toggle('active', delegated());
    $('mode-direct').setAttribute('aria-pressed', String(!delegated()));
    $('mode-delegated').setAttribute('aria-pressed', String(delegated()));
    $('verified-trade-note').hidden = !delegated();
    $('wallet-action').querySelectorAll('option').forEach(option => { option.disabled = delegated() && option.value !== 'CANCEL'; });
    $('wallet-action').value = delegated() ? 'CANCEL' : 'APPROVE';
    $('wallet-action').dispatchEvent(new window.Event('change'));
    $('position-heading').textContent = delegated() ? 'Wallet 1 position & open orders' : 'Your direct EOA position & open orders';
    $('mode-explanation').textContent = delegated() ?
      `MetaMask ${state.account ?? 'not connected'} signs as operator and pays gas. Wallet 1 ${embeddedAccount} owns margin, positions and orders. Rights are read from this pool before each action.` :
      'Direct Wallet uses only the connected EOA balance and margin. Wallet 1 funds are separate.';
    panel.querySelector('.eyebrow').textContent = delegated() ? 'DELEGATED PERPS · WALLET 1' : 'DIRECT WALLET TRADING';
    panel.querySelector('.trade-callout span').textContent = delegated() ?
      'Perp Canary checks the live pool grant and simulates placeOrderFor. MetaMask confirms each transaction; Wallet 1 keeps the position and margin.' :
      'Perp Canary prepares and simulates a direct pool call. Your connected wallet signs and sends it only after review.';
    $('trade-review').querySelector('h3').textContent = `Review ${delegated() ? 'delegated' : 'direct'} ${$('market-select').value} order`;
    text('wallet-balances', 'Reading selected trading account…');
    text('wallet-permissions', delegated() ? 'Checking pool grant…' : 'Direct EOA: no operator grant required.');
    text('wallet-position', 'Reading selected market position and orders…');
    $('wallet-orders').replaceChildren();
    clearPositionIntelligence('Reading selected account position…');
    invalidate(); if (connected()) loadAccount();
  }
  $('mode-direct').onclick = () => switchMode('DIRECT');
  $('mode-delegated').onclick = () => switchMode('DELEGATED_PERPS');
  $('load-order-history').onclick = async () => {
    if (!connected()) { text('history-status', 'Connect a wallet on Hideki 50383 first.'); return; }
    const id = ++state.historyRequestId, account = state.account, mode = state.mode;
    const market = $('market-select').value;
    $('load-order-history').disabled = true;
    text('history-status', 'Reading finished orders from the official SDK indexer (timeout 60 seconds)…');
    try { const result = await request(`/api/v1/trade/history?account=${encodeURIComponent(account)}&mode=${mode}&market=${encodeURIComponent(market)}`);
      if (id !== state.historyRequestId || account !== state.account || mode !== state.mode ||
        market !== $('market-select').value) return;
      $('history-rows').replaceChildren(...result.rows.map(row => {
        const div = document.createElement('div'); div.className = 'journal-entry';
        div.textContent = `#${row.id} · ${row.side} ${row.originalQuantity} @ ${row.price} · ${row.status} · filled ${row.filledQuantity} · ended ${new Date(row.endedAt).toLocaleString()}`;
        div.title = `${row.placedTxHash} · ${row.cancelReason ?? 'no reported cancellation reason'}`;
        return div;
      }));
      text('history-status', `${result.rows.length} indexed finished orders for ${result.owner}. ${result.note}`);
    } catch (error) { if (id === state.historyRequestId)
      text('history-status', `Order history unavailable: ${error.message}. Retry when the indexer is reachable.`); }
    finally { $('load-order-history').disabled = false; }
  };
  function invalidate() {
    state.plan = null; $('trade-review').hidden = true;
    $('confirm-wallet').disabled = true;
    idleGuard();
    invalidateAction();
  }
  function invalidateAction() {
    state.actionPlan = null; $('action-review').hidden = true; $('confirm-action').disabled = true;
    $('review-action').disabled = !connected() || state.busy || !!state.pendingHash || !!state.actionPending ||
      ($('wallet-action').value === 'CANCEL' && !$('action-order-id').value);
  }
  function displayAccount() {
    $('wallet-connect').hidden = !!state.account;
    $('wallet-disconnect').hidden = !state.account;
    $('wallet-identity').hidden = !state.account;
    $('wallet-identity').textContent = state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)}` : 'Wallet details';
    $('wallet-switch').hidden = !state.account || validChain();
    text('wallet-full-address', state.account ?? '—');
    $('wallet-copy-address').disabled = !state.account;
    if (!state.funding) {
      for (const id of ['wallet-native-stt', 'wallet-usdso-balance', 'wallet-margin-free',
        'wallet-margin-withdrawable']) text(id, '—');
      $('review-voucher').disabled = true; $('voucher-review').hidden = true;
      text('voucher-eligibility', 'Eligibility not checked.');
    }
    text('wallet-network', state.account ? `${validChain() ? 'Somnia Hideki' : 'Wrong network'} · chainId ${state.chainId ?? 'UNKNOWN'}` : '—');
    const identity = !state.account ? 'Wallet disconnected.' :
      state.account.toLowerCase() === expectedMetaMask.toLowerCase() ?
        'External MetaMask EOA. DreamDEX smart-account funds are separate.' :
        state.account.toLowerCase() === embeddedAccount.toLowerCase() ?
          'Known dreamDEX smart account address reported by provider. Verify the provider before any action.' :
          `ACCOUNT MISMATCH: expected MetaMask ${expectedMetaMask}. Trading uses the connected account only.`;
    text('wallet-identity-warning', identity);
    $('wallet-identity-warning').dataset.kind = state.account &&
      state.account.toLowerCase() !== expectedMetaMask.toLowerCase() ? 'warn' : '';
    text('wallet-state', state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)} · ${validChain() ? 'Hideki 50383' : 'wrong network'}` :
      'Connect an EIP-1193 wallet to trade directly.');
    if (!state.account) { $('wallet-details').hidden = true; $('wallet-identity').setAttribute('aria-expanded', 'false');
      state.funding = null; state.voucherPlan = null;
      for (const id of ['wallet-native-stt', 'wallet-usdso-balance', 'wallet-margin-free',
        'wallet-margin-withdrawable']) text(id, '—');
      text('voucher-eligibility', 'Eligibility not checked.'); $('review-voucher').disabled = true;
      text('wallet-balances', 'Wallet balance and MarginBank: not read');
      text('wallet-permissions', 'Trading permissions: connect a wallet on Hideki 50383.');
      text('wallet-position', 'Connect a wallet to read your own position and open orders.');
      $('wallet-orders').replaceChildren(); }
    renderJournal();
    accountSummary(state.accountData);
    invalidate();
  }
  async function loadAccount() {
    if (!connected()) return;
    const id = ++state.requestId;
    const selectedMarket = $('market-select').value;
    const selectedMode = state.mode;
    text('wallet-balances', 'Reading selected market account (timeout 60 seconds)…');
    text('wallet-position', 'Reading selected market position and orders…');
    try { const url = delegated() ?
      `/api/v1/trade/delegated/account?operator=${encodeURIComponent(state.account)}&market=${encodeURIComponent(selectedMarket)}` :
      `/api/v1/trade/account?account=${encodeURIComponent(state.account)}&market=${encodeURIComponent(selectedMarket)}`;
      const data = await request(url);
      if (id !== state.requestId || selectedMode !== state.mode ||
        data.account.toLowerCase() !== state.account.toLowerCase() ||
        selectedMarket !== $('market-select').value) return;
      state.accountData = data;
      accountSummary(data);
      text('wallet-balances', delegated() ?
        `Operator gas ${data.gasStt} STT · Wallet 1 free margin ${data.marginUnlocked} USDso · owner ${data.owner}` :
        `EOA gas ${data.gasStt} STT · wallet USDso ${data.walletUsdso} · allowance ${data.allowance ?? 'UNKNOWN'} · EOA free margin ${data.marginUnlocked}`);
      text('wallet-permissions', delegated() ?
        `Pool grants: place ${data.permissions.place ? 'ACTIVE' : 'BLOCKED'} · cancel ${data.permissions.cancel ? 'ACTIVE' : 'BLOCKED'} · reduce ${data.permissions.reduce ? 'ACTIVE' : 'BLOCKED'}. Scope: ${data.permissions.scope}` :
        'Direct EOA: no delegated grant required. Wallet confirmation required for each action.');
      text('wallet-position', `Position ${displayNumber(data.position.size ?? data.position.sizeBtc, 8)} ${data.market?.replace('-PERP', '') ?? 'BTC'} · entry ${displayNumber(data.position.entryPrice, 4)} USDso · ${data.openOrders.length} open orders (block ${data.block})`);
      const rows = data.openOrders.map(order => {
        const row = document.createElement('div'); row.className = 'wallet-order-row';
        const detail = document.createElement('span');
        detail.textContent = `#${order.id} · ${order.side} ${order.remaining} ${data.market?.replace('-PERP', '') ?? 'BTC'} @ ${order.price} USDso`;
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button secondary';
        cancel.textContent = 'Review cancel'; cancel.onclick = () => {
          $('wallet-action').value = 'CANCEL'; $('action-order-id').value = order.id;
          $('action-order-label').hidden = false; $('action-amount').parentElement.hidden = true;
          invalidateAction(); activateTab('balances'); $('review-action').focus();
        };
        row.append(detail, cancel);
        return row;
      });
      $('wallet-orders').replaceChildren(...rows);
      if ($('wallet-action').value === 'CANCEL' && $('action-order-id').value &&
        !data.openOrders.some(order => order.id === $('action-order-id').value)) {
        $('action-order-id').value = ''; $('action-order-label').hidden = true; invalidateAction();
      }
      for (const entry of readJournal()) {
        if (entry.account?.toLowerCase() === data.account.toLowerCase() && entry.market === data.market &&
          entry.action === 'PLACE' && entry.orderId) {
          if (data.openOrders.some(order => order.id === entry.orderId))
            recordJournal(entry.hash, { state: 'RESTING', source: `SDK_OPEN_ORDERS_BLOCK_${data.block}` });
          else if (entry.state === 'RESTING') recordJournal(entry.hash, {
            state: 'UNKNOWN', source: `NOT_OPEN_AT_BLOCK_${data.block}` });
        }
      }
      loadPositionIntelligence();
    } catch (error) { if (id === state.requestId) {
      state.accountData = null; accountSummary(); text('wallet-balances', `Account read unavailable: ${error.message}`);
      text('wallet-permissions', delegated() ? 'Delegated permissions UNKNOWN; trading blocked until retry.' :
        'Direct balance UNKNOWN; trading blocked until retry.');
      text('wallet-position', 'Position and open orders UNKNOWN. Use Refresh balances or Refresh live data to retry.');
      $('wallet-orders').replaceChildren(); clearPositionIntelligence('Position metrics unavailable until the selected account read succeeds.'); } }
  }
  async function loadFunding() {
    if (!connected()) { text('wallet-details-status', 'Switch to Hideki 50383 before reading funding.'); return; }
    const id = ++state.fundingRequestId, account = state.account;
    text('wallet-details-status', 'Reading Hideki balances and voucher state (timeout 60 seconds)…');
    for (const field of ['wallet-native-stt', 'wallet-usdso-balance', 'wallet-margin-free',
      'wallet-margin-withdrawable']) text(field, 'Reading…');
    try {
      const data = await request(`/api/v1/wallet/funding?account=${encodeURIComponent(account)}`);
      if (id !== state.fundingRequestId || account?.toLowerCase() !== state.account?.toLowerCase()) return;
      state.funding = data;
      text('wallet-full-address', data.account);
      text('wallet-native-stt', `${data.nativeStt} STT`);
      text('wallet-usdso-balance', `${data.walletUsdso} transferable USDso`);
      text('wallet-margin-free', `${data.marginFreeUsdso} USDso (includes any paper credit)`);
      text('wallet-margin-withdrawable', `${data.marginWithdrawableUsdso} USDso`);
      text('voucher-eligibility', data.eligibility.eligible ?
        `ELIGIBLE at block ${data.block}: one-time ${data.eligibility.grantUsdso} paper USDso credit. Not an ERC-20 wallet balance; not withdrawable. BTC allowed: ${data.btcVoucherAllowed}.` :
        `INELIGIBLE at block ${data.block}: ${data.eligibility.reason}. Voucher floor ${data.voucher?.floorUsdso ?? 'UNKNOWN'} USDso.`);
      $('review-voucher').disabled = !data.eligibility.eligible || Number(data.nativeStt) <= 0 || !validChain();
      text('funding-remediation', Number(data.nativeStt) <= 0 ?
        'No Hideki STT. The official dreamDEX Link a Bot flow can send gas to this address. Linking also grants the operator limited trading rights; review that grant in dreamDEX.' :
        'Hideki gas is available. Review voucher eligibility and claim separately; no transaction is sent automatically.');
      text('wallet-details-status', `Read from Hideki RPC and official SDK at block ${data.block}. Refresh to update.`);
    } catch (error) {
      if (id !== state.fundingRequestId) return;
      state.funding = null; $('review-voucher').disabled = true;
      text('wallet-details-status', `Funding read unavailable: ${error.message}. Click Refresh balances to retry.`);
      for (const field of ['wallet-native-stt', 'wallet-usdso-balance', 'wallet-margin-free',
        'wallet-margin-withdrawable']) text(field, 'UNKNOWN');
      text('voucher-eligibility', 'UNKNOWN. Eligibility requires a fresh Hideki read.');
    }
  }
  async function loadMarkets() {
    status('Loading verified markets (timeout 60 seconds)…', 'warn');
    try { const result = await request('/api/v1/markets');
      const markets = result.markets;
      if (!Array.isArray(markets) || !markets.length || markets.some(row => row.marketType !== 'PERP'))
        throw Error('Verified perp registry is unavailable');
      state.marketRegistry = markets;
      window.__canaryMarkets = markets;
      const previous = $('market-select').value;
      const options = markets.sort((a, b) => a.symbol === 'BTC-PERP' ? -1 : b.symbol === 'BTC-PERP' ? 1 :
        a.symbol.localeCompare(b.symbol)).map(row => {
        const option = document.createElement('option'); option.value = row.symbol;
        option.textContent = `${row.symbol} / ${row.quote}${row.status === 'TRADEABLE' ? '' : ` (${row.status})`}`;
        option.dataset.poolStatus = row.status; return option;
      });
      $('market-select').replaceChildren(...options);
      if (options.some(option => option.value === previous)) $('market-select').value = previous;
      window.dispatchEvent(new window.CustomEvent('canary:markets', { detail: markets }));
      status(`${markets.filter(row => row.status === 'TRADEABLE').length} markets passed SDK and factory status checks.`, 'ok');
    } catch (error) { status(`Market registry unavailable: ${error.message}. Click Refresh live data to retry.`, 'warn'); }
  }
  function onAccounts(accounts) {
    const next = Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0] ?? '') ? accounts[0] : null;
    if (next?.toLowerCase() === state.account?.toLowerCase()) return;
    state.account = next; state.accountData = null; state.funding = null; state.voucherPlan = null;
    state.requestId++; state.fundingRequestId++; state.historyRequestId++;
    $('history-rows').replaceChildren(); text('history-status', 'History not requested for this wallet.');
    displayAccount();
    if (connected()) { loadAccount(); loadFunding(); }
    if (next) request(`/api/v1/wallet/identity?account=${encodeURIComponent(next)}`).then(identity => {
      if (state.account?.toLowerCase() === identity.account.toLowerCase()) text('wallet-full-address', identity.account);
    }).catch(() => { text('wallet-details-status', 'Address checksum unavailable; retry wallet refresh.'); });
  }
  async function onChain(hex) {
    const parsed = Number(hex); state.chainId = Number.isInteger(parsed) ? parsed : null;
    state.accountData = null; state.funding = null; state.voucherPlan = null;
    state.requestId++; state.fundingRequestId++; displayAccount();
    if (connected()) await Promise.all([loadAccount(), loadFunding()]);
  }
  $('wallet-connect').onclick = async () => {
    const provider = window.ethereum;
    if (!provider?.request) { status('No injected EIP-1193 wallet found. Install or enable a compatible wallet.', 'error'); return; }
    $('wallet-connect').disabled = true;
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !accounts.length) throw Error('Wallet returned no account.');
      const confirmed = await provider.request({ method: 'eth_accounts' });
      if (!Array.isArray(confirmed) || confirmed[0]?.toLowerCase() !== accounts[0]?.toLowerCase())
        throw Error('eth_accounts differs from the wallet connection response.');
      state.provider = provider;
      text('wallet-provider-name', provider.isMetaMask ? 'MetaMask-compatible injected provider' :
        provider.isRabby ? 'Rabby injected provider' : 'Injected EIP-1193 provider (unidentified)');
      provider.on?.('accountsChanged', onAccounts);
      provider.on?.('chainChanged', onChain);
      onAccounts(accounts);
      await onChain(await provider.request({ method: 'eth_chainId' }));
      status(validChain() ? 'Wallet connected. Review an order before any wallet prompt.' :
        'Wallet connected on another network. Switch to Hideki 50383.', validChain() ? 'ok' : 'warn');
    } catch (error) { status(`Wallet connection failed: ${error.message}`, 'error'); }
    finally { $('wallet-connect').disabled = false; }
  };
  $('wallet-switch').onclick = async () => {
    try { await state.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4cf' }] }); }
    catch (error) { if (error.code === 4902) {
      try { await state.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xc4cf',
        chainName: 'Somnia Hideki Testnet', nativeCurrency: { name: 'Test STT', symbol: 'STT', decimals: 18 },
        rpcUrls: ['https://api.hideki2.infra.testnet.somnia.network'],
        blockExplorerUrls: ['https://explorer.testnet.somnia.network/tokyo'] }] }); }
      catch (addError) { status(`Network addition rejected: ${addError.message}`, 'error'); return; }
    } else { status(`Network switch rejected: ${error.message}`, 'error'); return; } }
    await onChain(await state.provider.request({ method: 'eth_chainId' }));
  };
  $('wallet-disconnect').onclick = () => {
    state.provider?.removeListener?.('accountsChanged', onAccounts);
    state.provider?.removeListener?.('chainChanged', onChain);
    state.provider = null; state.account = null; state.chainId = null; state.accountData = null;
    state.requestId++; state.fundingRequestId++; displayAccount(); status('Application wallet session disconnected.');
  };
  $('wallet-identity').onclick = () => { const open = $('wallet-details').hidden;
    $('wallet-details').hidden = !open; $('wallet-identity').setAttribute('aria-expanded', String(open));
    if (open && connected() && !state.funding) loadFunding();
    if (open) request('/api/v1/wallet/embedded-ownership').then(result => {
      if (!$('wallet-details').hidden) text('embedded-wallet-status',
        `Known dreamDEX smart account ${result.account}. Safe threshold ${result.threshold}; ${
          result.metaMaskIsOwner ? 'expected MetaMask is an owner' : 'expected MetaMask is NOT an owner'}. Its funds are separate from the connected EOA.`);
    }).catch(error => { text('embedded-wallet-status', `Embedded ownership read unavailable: ${error.message}`); }); };
  $('nav-funding').onclick = event => { event.preventDefault();
    if (!state.account) { $('wallet-connect').focus();
      status('Connect an injected wallet to open Testnet Funding.', 'warn'); return; }
    if ($('wallet-details').hidden) $('wallet-identity').click();
    $('testnet-funding').scrollIntoView({ block: 'nearest' }); };
  $('wallet-details-close').onclick = () => { $('wallet-details').hidden = true;
    $('wallet-identity').setAttribute('aria-expanded', 'false'); };
  $('wallet-panel-disconnect').onclick = () => $('wallet-disconnect').click();
  $('wallet-panel-refresh').onclick = () => { if (connected()) { loadAccount(); loadFunding(); }
    else text('wallet-details-status', 'Connect a wallet on Hideki 50383 first.'); };
  $('wallet-copy-address').onclick = async () => { if (!state.account) return;
    try { await window.navigator.clipboard.writeText($('wallet-full-address').textContent);
      text('wallet-details-status', 'Connected wallet address copied.'); }
    catch (error) { text('wallet-details-status', `Copy failed: ${error.message}`); } };
  $('check-voucher').onclick = () => loadFunding();
  $('review-voucher').onclick = async () => {
    if (!connected() || !state.funding?.eligibility.eligible || state.busy || state.voucherPending) return;
    state.voucherPlan = null; $('voucher-review').hidden = true;
    state.busy = true; $('review-voucher').disabled = true;
    text('voucher-result', 'Checking fresh eligibility, gas, nonce and contract simulation…');
    try {
      const account = state.account;
      const plan = await request('/api/v1/wallet/voucher/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
      if (!connected() || account?.toLowerCase() !== state.account?.toLowerCase() ||
        plan.status !== 'READY_FOR_OWNER_CONFIRMATION') throw Error('Wallet changed or claim is not ready.');
      state.voucherPlan = plan;
      text('voucher-review-details', `Hideki 50383 · ${plan.grantUsdso} nonwithdrawable paper USDso credit · recipient ${plan.account} · distributor ${plan.transaction.to} · selector ${plan.transaction.data} · nonce ${plan.transaction.nonce} · max simulated gas ${plan.transaction.maxGasCostStt} STT. One claim per address; no wallet ERC-20 transfer.`);
      $('voucher-review').hidden = false;
      text('voucher-result', 'READY_FOR_OWNER_CONFIRMATION. Claim only after reviewing the exact call.');
    } catch (error) { text('voucher-result', `Claim review blocked: ${error.message}`); }
    finally { state.busy = false; $('review-voucher').disabled = !connected() ||
      !state.funding?.eligibility.eligible || Number(state.funding?.nativeStt ?? 0) <= 0; }
  };
  $('dismiss-voucher').onclick = () => { state.voucherPlan = null; $('voucher-review').hidden = true;
    text('voucher-result', 'Claim review cancelled. No transaction sent.'); };
  $('confirm-voucher').onclick = async () => {
    const prior = state.voucherPlan;
    if (!prior || !connected() || state.busy || state.voucherPending) return;
    state.busy = true; $('confirm-voucher').disabled = true;
    text('voucher-result', 'Rechecking claim immediately before wallet confirmation…');
    try {
      const [chain, accounts] = await Promise.all([
        state.provider.request({ method: 'eth_chainId' }),
        state.provider.request({ method: 'eth_accounts' }),
      ]);
      if (Number(chain) !== 50383 || !Array.isArray(accounts) ||
        accounts[0]?.toLowerCase() !== prior.account.toLowerCase() ||
        state.account?.toLowerCase() !== prior.account.toLowerCase()) throw Error('Wallet account or chain changed.');
      const fresh = await request('/api/v1/wallet/voucher/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: prior.account }) });
      const tx = fresh.transaction, old = prior.transaction;
      if (fresh.status !== 'READY_FOR_OWNER_CONFIRMATION' || tx.to.toLowerCase() !== old.to.toLowerCase() ||
        tx.from.toLowerCase() !== old.from.toLowerCase() || tx.data !== old.data ||
        tx.value !== old.value || tx.gas !== old.gas || tx.nonce !== old.nonce)
        throw Error('Fresh claim differs from review. Review again.');
      text('voucher-result', 'Waiting for explicit MetaMask confirmation…');
      const hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas,
        nonce: `0x${tx.nonce.toString(16)}` }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
      state.voucherPlan = null; $('voucher-review').hidden = true;
      state.voucherPending = { hash, account: prior.account };
      recordJournal(hash, { account: prior.account, market: 'HIDEKI', action: 'VOUCHER_CLAIM', state: 'SUBMITTED' });
      text('voucher-result', `Submitted ${hash}. Checking independent receipt and voucher state…`);
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(`/api/v1/wallet/voucher/receipt?hash=${encodeURIComponent(hash)}&account=${encodeURIComponent(prior.account)}`);
        if (receipt.state !== 'PENDING') { state.voucherPending = null;
          recordJournal(hash, { state: receipt.state, source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          text('voucher-result', `Voucher claim ${receipt.state} at block ${receipt.block ?? 'UNKNOWN'}${receipt.reason ? `: ${receipt.reason}` : ''}.`);
          await loadFunding(); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      text('voucher-result', `Claim ${hash} remains pending. Refresh balances before another action.`);
    } catch (error) { state.voucherPlan = null; $('voucher-review').hidden = true;
      text('voucher-result', `Claim stopped: ${error.message}. No retry was sent.`); }
    finally { state.busy = false; $('confirm-voucher').disabled = false; }
  };
  for (const id of ['quantity', 'limit-price']) $(id).addEventListener('input', invalidate);
  window.addEventListener('canary:side', event => { state.side = event.detail; state.sizedQuantity = null;
    $('use-sized-quantity').disabled = true; invalidate(); });
  window.addEventListener('canary:market', event => {
    state.market = event.detail; invalidate(); state.sizedQuantity = null;
    $('use-sized-quantity').disabled = true;
    const radar = event.detail?.radar;
    text('radar-state', radar?.status ?? 'UNKNOWN');
    text('radar-details', radar?.status === 'UNKNOWN' || !radar ?
      'Trusted live data is unavailable; no market signal is claimed.' :
      `Spread ${radar.spreadBps.toFixed(1)} bps · visible bid share ${radar.imbalancePercent === null ? 'UNKNOWN' : `${radar.imbalancePercent.toFixed(0)}%`} · mark change ${radar.priceChangeBps === null ? 'UNKNOWN' : `${radar.priceChangeBps.toFixed(1)} bps`}.`);
    $('radar-state').dataset.status = radar?.status ?? 'UNKNOWN';
    $('radar-alerts').replaceChildren(...(radar?.alerts ?? []).map(message => {
      const item = document.createElement('p'); item.textContent = message; return item;
    }));
  });
  $('calculate-size').onclick = async () => {
    state.sizedQuantity = null; $('use-sized-quantity').disabled = true;
    text('size-result', 'Calculating with verified market tick and lot…');
    const draft = { market: $('market-select').value, side: state.side, capital: $('size-capital').value.trim(),
      riskPercent: $('size-risk').value.trim(), entry: $('limit-price').value.trim(),
      stop: $('size-stop').value.trim(), absoluteRiskUsdso: $('size-absolute-risk').value.trim(),
      availableMarginUsdso: state.accountData?.marginUnlocked ?? '' };
    try { const result = await request('/api/v1/intelligence/size', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      if (draft.market !== $('market-select').value || draft.side !== state.side ||
        draft.entry !== $('limit-price').value.trim()) throw Error('Market, side or entry changed; calculate again');
      text('size-result', `${result.confidence} · ${result.status}: risk budget ${result.riskBudgetUsdso} USDso · ${result.quantity} ${$('market-select').value.replace('-PERP', '')} · notional ${result.notionalUsdso} USDso · estimated initial margin ${result.initialMarginUsdso} USDso · invalidation distance ${result.invalidationDistancePercent}% · loss at reference ${result.lossAtStopUsdso} USDso. ${result.assumptions}`);
      if (result.status === 'CALCULATED') { state.sizedQuantity = result.quantity;
        $('use-sized-quantity').disabled = false; }
    } catch (error) { text('size-result', `Sizing unavailable: ${error.message}`); }
  };
  $('use-sized-quantity').onclick = () => { if (!state.sizedQuantity) return;
    $('quantity').value = state.sizedQuantity; $('quantity').dispatchEvent(new window.Event('input', { bubbles: true })); };
  for (const id of ['size-capital', 'size-risk', 'size-absolute-risk', 'size-stop', 'limit-price']) $(id).addEventListener('input', () => {
    state.sizedQuantity = null; $('use-sized-quantity').disabled = true;
  });
  $('market-select').onchange = () => { state.accountData = null; state.requestId++; accountSummary(); invalidate();
    state.historyRequestId++; state.positionRequestId++; state.positionMetrics = null;
    clearPositionIntelligence('Reading the selected market position…');
    $('history-rows').replaceChildren();
    text('history-status', 'History not requested for this market.');
    panel.querySelector('h2').textContent = `Trade ${$('market-select').value}`;
    $('trade-review').querySelector('h3').textContent = `Review ${delegated() ? 'delegated' : 'direct'} ${$('market-select').value} order`;
    status(`Loading verified ${$('market-select').value} market…`);
    text('wallet-position', 'Reading selected market position and orders…');
    if (connected()) loadAccount(); };
  $('wallet-action').onchange = () => {
    const cancel = $('wallet-action').value === 'CANCEL';
    $('action-order-label').hidden = !cancel; $('action-amount').parentElement.hidden = cancel;
    if (!cancel) $('action-order-id').value = '';
    invalidateAction();
  };
  $('action-amount').oninput = invalidateAction;
  function actionDraft() { return { account: state.account, market: $('market-select').value,
    action: $('wallet-action').value, amount: $('action-amount').value.trim(),
    orderId: $('action-order-id').value.trim(),
    ...(delegated() ? { mode: 'DELEGATED_PERPS', owner: embeddedAccount } : {}) }; }
  $('review-action').onclick = async () => {
    if (!connected() || state.busy || state.pendingHash || state.actionPending) return;
    invalidateAction(); state.busy = true; $('review-action').disabled = true;
    const draft = actionDraft(); actionStatus('Simulating exact wallet action…', 'warn');
    try { if (delegated() && draft.action !== 'CANCEL') throw Error('Delegated operator cannot approve, deposit or withdraw Wallet 1 funds');
      const plan = await request(delegated() ? '/api/v1/trade/delegated/cancel/prepare' :
        '/api/v1/trade/action/prepare', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      if (!connected() || draft.account.toLowerCase() !== state.account.toLowerCase() ||
        JSON.stringify(draft) !== JSON.stringify(actionDraft())) throw Error('Wallet or action changed during review.');
      state.actionPlan = { input: draft, result: plan };
      text('action-details', delegated() ?
        `Cancel Wallet 1 ${draft.market} order #${draft.orderId}. Operator ${draft.account} pays gas; margin stays with ${embeddedAccount}.` :
        `${draft.action} · ${draft.market} · ${draft.action === 'CANCEL' ?
          `order #${draft.orderId}` : `${draft.amount} USDso`} · allowance ${plan.allowance} USDso · wallet ${plan.walletUsdso} USDso · withdrawable ${plan.withdrawable} USDso`);
      text('action-contract', `Hideki 50383 · ${plan.transaction.to} · from ${plan.transaction.from} · selector ${plan.transaction.data.slice(0, 10)} · nonce ${plan.transaction.nonce} · max simulated gas ${plan.transaction.maxGasCostStt} STT`);
      $('action-review').hidden = false; $('confirm-action').disabled = false;
      actionStatus('Review the exact action, then confirm explicitly in your wallet.', 'ok');
    } catch (error) { actionStatus(`Action blocked: ${error.message}`, 'error'); invalidateAction();
      if (error.code === 'ORDER_NOT_OPEN' && connected() && delegated() &&
        draft.account.toLowerCase() === state.account.toLowerCase()) {
        await loadAccount(); $('load-order-history').click();
      } }
    finally { state.busy = false; $('review-action').disabled = !connected() || !!state.pendingHash || !!state.actionPending ||
      ($('wallet-action').value === 'CANCEL' && !$('action-order-id').value); }
  };
  $('dismiss-action').onclick = () => { invalidateAction(); actionStatus('Wallet action review closed.'); };
  $('confirm-action').onclick = async () => {
    if (!state.actionPlan || state.busy || !connected() || state.pendingHash || state.actionPending) return;
    const reviewed = state.actionPlan;
    state.busy = true; $('confirm-action').disabled = true; $('review-action').disabled = true;
    actionStatus('Rechecking balance, allowance, order status and simulation…', 'warn');
    try {
      const chain = Number(await state.provider.request({ method: 'eth_chainId' }));
      const accounts = await state.provider.request({ method: 'eth_accounts' });
      if (chain !== 50383 || !Array.isArray(accounts) ||
        accounts[0]?.toLowerCase() !== reviewed.input.account.toLowerCase())
        throw Error('Wallet account or network changed.');
      const fresh = await request(reviewed.input.mode === 'DELEGATED_PERPS' ?
        '/api/v1/trade/delegated/cancel/prepare' : '/api/v1/trade/action/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(reviewed.input) });
      const tx = fresh.transaction, prior = reviewed.result.transaction;
      let gasNotice = '';
      if (reviewed.input.mode === 'DELEGATED_PERPS') {
        const verdict = compareDelegatedCancel(reviewed, actionDraft(), fresh);
        if (!connected() || !verdict.ok) throw Error(verdict.issues.map(issue =>
          `${issue.field}: ${issue.reason}`).join(' ') || 'Wallet changed. Review cancellation again.');
        if (verdict.gasChanged) gasNotice = ` Fresh simulated gas changed to ${tx.maxGasCostStt} STT within the 0.1 STT cap.`;
      } else if (!connected() || JSON.stringify(reviewed.input) !== JSON.stringify(actionDraft()) ||
        tx.chainId !== 50383 || tx.value !== '0x0' || tx.from.toLowerCase() !== prior.from.toLowerCase() ||
        tx.to.toLowerCase() !== prior.to.toLowerCase() || tx.data !== prior.data ||
        tx.gas !== prior.gas || tx.nonce !== prior.nonce)
        throw Error('Fresh action preflight differs. Review again.');
      actionStatus(`Waiting for explicit wallet approval…${gasNotice}`, 'warn');
      const hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas,
        nonce: `0x${tx.nonce.toString(16)}` }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
      state.actionPlan = null; $('action-review').hidden = true;
      state.actionPending = { hash, data: tx.data, ...reviewed.input }; invalidate();
      recordJournal(hash, { account: reviewed.input.account,
        owner: reviewed.input.owner ?? reviewed.input.account, mode: reviewed.input.mode ?? 'DIRECT',
        market: reviewed.input.market,
        action: reviewed.input.action, orderId: reviewed.input.orderId || null, state: 'SUBMITTED' });
      actionStatus(`Submitted ${hash}. Reading independent receipt…`, 'warn');
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(actionReceiptUrl({ hash, ...reviewed.input }));
        if (receipt.state !== 'PENDING') { state.actionPending = null;
          recordJournal(hash, { state: receipt.state === 'CANCELLED' ? 'CANCELLED' : receipt.state === 'CONFIRMED' ?
            reviewed.input.action === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED' : receipt.state,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          actionStatus(`${reviewed.input.action} ${receipt.state} at block ${receipt.block ?? 'UNKNOWN'}${receipt.reason ? `: ${receipt.reason}` : ''}. Account read follows.`,
            ['CONFIRMED', 'CANCELLED'].includes(receipt.state) ? 'ok' : 'error');
          await loadAccount(); invalidateAction(); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      actionStatus(`${reviewed.input.action} ${hash} remains pending. Use Refresh to check receipt.`, 'warn');
    } catch (error) { actionStatus(`Wallet action stopped: ${error.message}`, 'error'); invalidateAction();
      if (error.code === 'ORDER_NOT_OPEN' && connected() && delegated()) {
        await loadAccount(); $('load-order-history').click();
      } }
    finally { state.busy = false; $('review-action').disabled = !connected() || !!state.pendingHash || !!state.actionPending ||
      ($('wallet-action').value === 'CANCEL' && !$('action-order-id').value);
      $('review-order').disabled = !connected() || !!state.pendingHash || !!state.actionPending; }
  };
  $('refresh').addEventListener('click', async () => {
    loadMarkets();
    if (connected()) loadAccount();
    if (state.actionPending) {
      const pending = state.actionPending;
      try { const receipt = await request(actionReceiptUrl(pending));
        if (receipt.state === 'PENDING') actionStatus(`${pending.action} ${pending.hash} is still pending.`, 'warn');
        else { state.actionPending = null;
          recordJournal(pending.hash, { state: receipt.state === 'CANCELLED' ? 'CANCELLED' : receipt.state === 'CONFIRMED' ?
            pending.action === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED' : receipt.state,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          actionStatus(`${pending.action} ${receipt.state} at block ${receipt.block ?? 'UNKNOWN'}.`,
            ['CONFIRMED', 'CANCELLED'].includes(receipt.state) ? 'ok' : 'error'); invalidateAction(); }
      } catch (error) { actionStatus(`Action receipt read unavailable: ${error.message}`, 'error'); }
    }
    if (state.pendingHash && state.pendingAccount) {
      try { const receipt = await request(`${receiptUrl(state.pendingMode)}?hash=${encodeURIComponent(state.pendingHash)}&account=${encodeURIComponent(state.pendingAccount)}&market=${encodeURIComponent(state.pendingMarket)}${state.pendingMode === 'DELEGATED_PERPS' ? `&action=PLACE&expectedData=${encodeURIComponent(state.pendingData)}` : ''}`);
        if (receipt.state === 'PENDING') status(`Transaction ${state.pendingHash} is still pending.`, 'warn');
        else { recordJournal(state.pendingHash, { state: receipt.state === 'PLACED' ? 'CONFIRMED' : receipt.state,
          orderId: receipt.orderId ?? null, outcomeAtPlacement: receipt.outcomeAtPlacement ?? null,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          status(receipt.state === 'PLACED' ?
          `On-chain placement confirmed: order #${receipt.orderId}, block ${receipt.block}.` :
          `Transaction ${receipt.state}: ${receipt.reason ?? `block ${receipt.block}`}`,
        receipt.state === 'PLACED' ? 'ok' : 'error'); state.pendingHash = null; state.pendingAccount = null;
          state.pendingMarket = null; state.pendingMode = null; state.pendingData = null;
          $('review-order').disabled = !connected() || !$('trade-error').classList.contains('okay'); }
      } catch (error) { status(`Receipt read unavailable: ${error.message}`, 'error'); }
    }
  });
  $('review-order').onclick = async () => {
    if (!connected() || state.busy || state.pendingHash || state.actionPending) return;
    state.plan = null; $('trade-review').hidden = true; $('confirm-wallet').disabled = true;
    $('preflight-details').hidden = true; text('preflight-details', '');
    state.busy = true; $('review-order').disabled = true;
    text('guard-decision', 'CHECKING'); $('guard-decision').dataset.state = 'CHECKING';
    text('guard-verdict', 'CHECKING');
    text('guard-explanation', 'Checking fresh market, account, margin, gas and contract simulation…');
    status('Running Canary Trade Guard and contract simulation…');
    const draft = input();
    try {
      const plan = await request(prepareUrl(), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft) });
      if (!connected() || draft.account.toLowerCase() !== state.account.toLowerCase() ||
        draft.market !== $('market-select').value || JSON.stringify(draft) !== JSON.stringify(input()) ||
        draft.side !== state.side || draft.price !== $('limit-price').value.trim() ||
        draft.quantity !== $('quantity').value.trim()) throw Error('Wallet or order changed during review. Start again.');
      text('guard-verdict', plan.guard.verdict);
      $('guard-verdict').dataset.verdict = plan.guard.verdict;
      const guardView = renderGuardV2(plan, draft);
      text('margin-preview', plan.marginPreview?.status === 'OK' ?
        `${plan.marginPreview.lockUsdso} USDso lock · ${plan.marginPreview.initialRequirementUsdso} USDso initial requirement` :
        plan.marginPreview ? 'UNPRICEABLE' : 'NOT_RUN');
      text('gas-estimate', plan.transaction ? `${plan.transaction.maxGasCostStt} STT maximum at observed gas price` : 'NOT_RUN');
      if (plan.status !== 'READY' || !plan.transaction || guardView.decision === 'BLOCKED' ||
        guardView.decision === 'UNAVAILABLE') { status('Order blocked by Canary Trade Guard.', 'error'); return; }
      state.plan = { input: draft, result: plan };
      text('review-details', `${delegated() ? `Wallet 1 ${embeddedAccount} via operator ${draft.account}` : `Direct EOA ${draft.account}`} · ${draft.side} ${draft.quantity} ${draft.market} @ ${draft.price} USDso · PostOnly · estimated notional ${
        (Number(plan.guard.notionalRaw) / 1e18).toFixed(2)} USDso`);
      text('review-risk', `Guard ${plan.guard.verdict}. ${plan.guard.warnings.join(' ') || 'No observed caution.'} Current simulated gas cost ${plan.transaction.maxGasCostStt} STT; the hard safety cap is 0.1 STT. A fresh estimate may change within that cap before MetaMask shows the exact transaction.`);
      text('review-contract', `Hideki 50383 · pool ${plan.transaction.to} · from ${plan.transaction.from} · nonce ${plan.transaction.nonce} · expires ${plan.transaction.expiresAt}`);
      text('review-calldata', `Exact ${delegated() ? 'placeOrderFor' : 'placeOrder'} calldata: ${plan.transaction.data}`);
      $('trade-review').hidden = false; $('confirm-wallet').disabled = false;
      status('Review the exact wallet order, then confirm explicitly.', 'ok');
    } catch (error) { status(`Review unavailable: ${error.message}`, 'error'); invalidate();
      text('guard-decision', 'UNAVAILABLE'); text('guard-explanation', `Fresh checks could not complete: ${error.message}. Retry after market and RPC recover.`); }
    finally { state.busy = false; $('review-order').disabled = !connected() ||
      !$('trade-error').classList.contains('okay') || !!state.pendingHash || !!state.actionPending; }
  };
  $('dismiss-review').onclick = () => { invalidate(); status('Order review closed.'); };
  $('confirm-wallet').onclick = async () => {
    if (!state.plan || state.busy || !connected()) return;
    const reviewed = state.plan; state.busy = true; $('confirm-wallet').disabled = true;
    $('review-order').disabled = true; status('Rechecking market, margin and exact contract call…');
    let walletPrompted = false;
    try {
      const chain = Number(await state.provider.request({ method: 'eth_chainId' }));
      if (chain !== 50383 || chain !== state.chainId) throw Error('Wallet chain changed.');
      const accounts = await state.provider.request({ method: 'eth_accounts' });
      if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== reviewed.input.account.toLowerCase())
        throw Error('Wallet account changed.');
      const fresh = await request(reviewed.input.mode === 'DELEGATED_PERPS' ?
        '/api/v1/trade/delegated/prepare' : '/api/v1/trade/prepare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...reviewed.input, expiresAt: Date.parse(reviewed.result.transaction.expiresAt) }) });
      const verdict = comparePreflight(reviewed, input(), fresh);
      const tx = fresh.transaction;
      const context = verdict.context;
      const details = `Limit ${context.limitPrice} USDso · fresh bid ${context.bid ?? 'UNKNOWN'} / ask ${context.ask ?? 'UNKNOWN'} · owner free margin ${context.marginUsdso ?? 'UNKNOWN'} USDso · place grant ${context.placeGrant === null ? 'UNKNOWN' : context.placeGrant ? 'ACTIVE' : 'REVOKED'} · simulation ${context.simulation} · fresh estimated max gas ${context.gasEstimateStt ?? 'UNKNOWN'} STT.`;
      if (!verdict.ok || !connected()) {
        invalidate();
        text('guard-verdict', 'RED'); $('guard-verdict').dataset.verdict = 'RED';
        const reasons = verdict.issues.map(issue => `${issue.field}: ${issue.reason}`);
        if (!connected()) reasons.push('wallet: Account or network disconnected; connect and review again.');
        text('guard-explanation', reasons.join(' '));
        text('preflight-details', `${reasons.join(' ')} ${details} Edit the order or start a fresh review; no transaction was requested.`);
        $('preflight-details').hidden = false;
        status(`Wallet trade stopped: ${reasons[0]}`, 'error'); return;
      }
      const freshGuard = explainGuard(fresh, reviewed.input);
      if (freshGuard.decision === 'BLOCKED' || freshGuard.decision === 'UNAVAILABLE')
        throw Error(`Fresh Canary Guard: ${freshGuard.decision}. ${freshGuard.nextAction}`);
      text('preflight-details', `${verdict.changes.map(change => change.reason).join(' ')} ${details}`);
      $('preflight-details').hidden = false;
      status('Fresh Trade Guard and simulation passed. Waiting for your explicit wallet confirmation…', 'warn');
      walletPrompted = true;
      const hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas,
        nonce: `0x${tx.nonce.toString(16)}` }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
      state.pendingHash = hash; state.pendingAccount = tx.from; state.pendingMarket = reviewed.input.market;
      state.pendingMode = reviewed.input.mode ?? 'DIRECT'; state.pendingData = tx.data;
      state.plan = null; $('trade-review').hidden = true;
      recordJournal(hash, { account: tx.from, owner: reviewed.input.owner ?? tx.from,
        mode: reviewed.input.mode ?? 'DIRECT', market: reviewed.input.market, action: 'PLACE',
        side: reviewed.input.side, quantity: reviewed.input.quantity, price: reviewed.input.price,
        state: 'SUBMITTED' });
      status(`Submitted ${hash}. Waiting for an independently read receipt…`, 'warn');
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(`${receiptUrl(state.pendingMode)}?hash=${encodeURIComponent(hash)}&account=${encodeURIComponent(tx.from)}&market=${encodeURIComponent(reviewed.input.market)}${state.pendingMode === 'DELEGATED_PERPS' ? `&action=PLACE&expectedData=${encodeURIComponent(tx.data)}` : ''}`);
        if (receipt.state !== 'PENDING') { state.pendingHash = null; state.pendingAccount = null;
          state.pendingMarket = null; state.pendingMode = null; state.pendingData = null;
          recordJournal(hash, { state: receipt.state === 'PLACED' ? 'CONFIRMED' : receipt.state,
            orderId: receipt.orderId ?? null, outcomeAtPlacement: receipt.outcomeAtPlacement ?? null,
            source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          status(receipt.state === 'PLACED' ?
          `On-chain placement confirmed: order #${receipt.orderId}, block ${receipt.block}. Current open/fill state is separate.` :
          `Transaction ${receipt.state}: ${receipt.reason ?? `block ${receipt.block}`}`, receipt.state === 'PLACED' ? 'ok' : 'error');
          await loadAccount(); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      status(`Transaction ${hash} remains pending. Refresh to recheck the account.`, 'warn');
    } catch (error) {
      invalidate();
      if (!walletPrompted) {
        const field = /expir/i.test(error.message) ? 'expiry' : /nonce/i.test(error.message) ? 'nonce' :
          /market|book|PostOnly/i.test(error.message) ? 'book' : /margin|collateral/i.test(error.message) ? 'margin' :
            /grant|permission/i.test(error.message) ? 'permission' : /simulation|contract/i.test(error.message) ?
              'simulation' : 'preflight';
        text('guard-verdict', 'RED'); $('guard-verdict').dataset.verdict = 'RED';
        text('guard-explanation', `${field}: ${error.message}`);
        text('preflight-details', `${field}: ${error.message} Selected limit ${reviewed.input.price} USDso. Fresh book, margin, grant and simulation are UNKNOWN because the preflight did not complete. Review again; no transaction was requested.`);
        $('preflight-details').hidden = false;
      }
      status(`Wallet trade stopped: ${error.message}`, 'error');
    }
    finally { state.busy = false; $('review-order').disabled = !connected() ||
      !$('trade-error').classList.contains('okay') || !!state.pendingHash || !!state.actionPending; }
  };
  displayAccount(); loadMarkets();
})();
