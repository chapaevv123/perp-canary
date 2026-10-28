/* global localStorage, AbortController, clearTimeout, crypto, setInterval, URL, Blob */
import { marketScore, evaluateAlert, mergeOrderPages, sourceTime } from './product-intelligence.js';

(() => {
  const $ = id => document.getElementById(id);
  const shell = document.querySelector('.shell');
  const nav = document.createElement('nav'); nav.id = 'product-nav'; nav.setAttribute('aria-label', 'Product workspaces');
  nav.innerHTML = '<button id="workspace-terminal" type="button">Terminal</button><button id="workspace-radar" type="button">Market Radar</button><button id="workspace-alerts" type="button">Alerts</button><button id="workspace-journal" type="button">Trade Journal</button><button id="workspace-plan" type="button">Position Sizing</button>';
  shell.querySelector('.page-head').after(nav);
  const area = document.createElement('div'); area.id = 'product-workspaces'; nav.after(area);
  area.innerHTML = `
    <section id="radar-workspace" class="panel product-workspace" hidden><div class="panel-head"><div><div class="eyebrow">DISCOVER · VERIFIED PERP REGISTRY</div><h2>Canary Market Radar</h2></div><button id="radar-scan" class="button secondary" type="button">Scan verified markets</button></div>
      <p>Operational market quality only. Scores are unavailable without a fresh trusted book and verified depth. 24h change and volume are unavailable until a verified 24h source is connected.</p>
      <div class="product-filters"><label>Sort <select id="radar-sort"><option value="score">Canary score</option><option value="spread">Spread</option><option value="freshness">Freshness</option><option value="liquidity">Visible liquidity</option><option value="activity">Recent activity</option><option value="funding">Funding</option></select></label><label>Show <select id="radar-filter"><option value="all">All verified perps</option><option value="favorites">Favorites</option><option value="fresh">Fresh trusted quotes</option></select></label></div>
      <p id="radar-progress" role="status">Waiting for verified market registry.</p><div class="product-table-wrap"><table class="product-table"><thead><tr><th>Market</th><th>Mark</th><th>Bid / Ask</th><th>Spread</th><th>Visible depth</th><th>Activity</th><th>Funding</th><th>24h change / volume</th><th>Health</th><th>Canary score</th><th></th></tr></thead><tbody id="radar-rows"></tbody></table></div></section>
    <section id="alerts-workspace" class="panel product-workspace" hidden><div class="panel-head"><div><div class="eyebrow">MONITOR · OPEN BROWSER ONLY</div><h2>Canary Alerts</h2></div><button id="alerts-check" class="button secondary" type="button">Check now</button></div>
      <p>Alerts are stored in this browser profile and scoped to the connected address (or an anonymous local profile). They are evaluated only while this page is open. No wallet signature or background server monitoring.</p>
      <form id="alert-form" class="product-filters"><label>Market <select id="alert-market"></select></label><label>Condition <select id="alert-type"><option value="PRICE_ABOVE">Price crosses above</option><option value="PRICE_BELOW">Price crosses below</option><option value="SPREAD_ABOVE">Spread crosses above (bps)</option><option value="FEED_STALE">Trusted feed becomes stale</option><option value="FEED_RECOVERED">Trusted feed recovers</option><option value="FUNDING_ABOVE">Funding crosses above (%)</option></select></label><label>Threshold <input id="alert-threshold" type="text" inputmode="decimal" placeholder="Required for threshold alerts"></label><button id="alert-save" class="button primary" type="submit">Create alert</button><button id="alert-cancel-edit" class="button secondary" type="button" hidden>Cancel edit</button></form>
      <p id="alerts-status" role="status">No evaluation yet.</p><div id="alerts-list"></div><h3>Trigger history</h3><div id="alert-events"></div></section>
    <section id="journal-workspace" class="panel product-workspace" hidden><div class="panel-head"><div><div class="eyebrow">LEARN · INDEXED ORDER EVIDENCE</div><h2>Trade Journal</h2></div><button id="journal-load" class="button secondary" type="button">Load account history</button></div>
      <p>Official SDK finished-order history can lag the chain. Placement is not a fill. Fees, execution price, realized PnL and win/loss remain unavailable without matching evidence.</p>
      <div class="product-filters"><label>Status <select id="journal-status-filter"><option value="all">All statuses</option><option value="Filled">Filled</option><option value="Cancelled">Cancelled</option><option value="Partial">Partial</option></select></label><label>Since <input id="journal-date-filter" type="date"></label><label>Evidence <select id="journal-evidence-filter"><option value="all">All evidence</option><option value="verified">Verified replay</option><option value="indexer">SDK indexer</option></select></label><button id="journal-more" class="button secondary" type="button" disabled>Load next page</button><button id="journal-export" class="button secondary" type="button" disabled>Export CSV</button></div>
      <p id="journal-status" role="status">Connect a wallet on Hideki to read account history. The verified Canary execution remains available in Execution Replay.</p><p id="journal-analytics">Executed volume: unavailable until indexed history loads. Realized PnL: unavailable.</p><div class="product-table-wrap"><table class="product-table"><thead><tr><th>Market</th><th>Side</th><th>Order</th><th>Status</th><th>Requested</th><th>Filled</th><th>Limit</th><th>Execution</th><th>Role</th><th>Fees</th><th>Position impact</th><th>Ended</th><th>Tx hashes</th><th>Evidence</th><th></th></tr></thead><tbody id="journal-rows"></tbody></table></div></section>`;
  const sections = [...shell.children].filter(node => node !== shell.querySelector('.page-head') && node !== nav && node !== area);
  const registry = new Map(), snapshots = new Map(), pendingSamples = new Map();
  let scanSerial = 0, scanning = false, journalRows = [], journalOffset = 0, journalNext = null;
  let journalIdentity = '', journalBusy = false, editAlertId = null, alertScope = 'anonymous', visibleJournalRows = [];
  const alertKey = 'perp-canary/alerts/v1', eventKey = 'perp-canary/alert-events/v1';
  const storage = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : fallback; } catch { return fallback; } };
  const save = (key, rows) => { try { localStorage.setItem(key, JSON.stringify(rows)); return true; }
    catch { $('alerts-status').textContent = 'Browser storage unavailable; alerts will not persist.'; return false; } };
  const rows = () => storage(alertKey, []).filter(row => row && row.scope === alertScope && typeof row.id === 'string');
  const saveAlerts = scoped => save(alertKey, [
    ...storage(alertKey, []).filter(row => row?.scope !== alertScope), ...scoped].slice(-300));
  const txt = (id, value) => { $(id).textContent = value; };
  const label = value => value == null || value === '' ? 'Unavailable' : String(value);
  async function read(url, timeoutMs = 12_000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      return data;
    } finally { clearTimeout(timer); }
  }
  function switchTo(name) {
    const terminal = name === 'terminal' || name === 'plan';
    for (const node of sections) node.classList.toggle('product-hidden', !terminal);
    for (const section of area.children) section.hidden = section.id !== `${name}-workspace`;
    nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.id === `workspace-${name}`)));
    if (name === 'plan') {
      const card = document.querySelector('.sizing-card');
      const parent = card?.closest('details'); if (parent) parent.open = true;
      card?.scrollIntoView({ block: 'start' });
    }
    if (name === 'journal' && !journalRows.length) loadJournal();
    if (name === 'radar') renderRadar();
    if (name === 'alerts') refreshAlertScope();
  }
  for (const name of ['terminal', 'radar', 'alerts', 'journal', 'plan'])
    $(`workspace-${name}`).onclick = () => switchTo(name);
  switchTo('terminal');
  function updateRegistry(markets, cached = false) {
    if (!Array.isArray(markets)) return;
    for (const market of markets) if (market.marketType === 'PERP' && /^[A-Z0-9]{2,16}-PERP$/.test(market.symbol))
      registry.set(market.symbol, market);
    $('alert-market').replaceChildren(...[...registry.keys()].sort().map(symbol => {
      const option = document.createElement('option'); option.value = symbol; option.textContent = symbol; return option;
    }));
    if (!cached && registry.size) { try { localStorage.setItem('perp-canary/verified-registry/v1',
      JSON.stringify({ at: new Date().toISOString(), markets: [...registry.values()] })); } catch { /* optional cache */ } }
    renderRadar();
    if (cached) txt('radar-progress', `${registry.size} previously verified PERPs · registry is offline. Current status and quotes must be rescanned; trading eligibility is unknown.`);
  }
  window.addEventListener('canary:markets', event => updateRegistry(event.detail));
  if (window.__canaryMarkets) updateRegistry(window.__canaryMarkets);
  else read('/api/v1/markets', 45_000).then(result => updateRegistry(result.markets))
    .catch(error => { let old = null; try { old = JSON.parse(localStorage.getItem('perp-canary/verified-registry/v1') || 'null'); }
      catch { /* cache unavailable */ }
      if (old?.markets && Date.now() - Date.parse(old.at) < 86_400_000) updateRegistry(old.markets, true);
      else txt('radar-progress', `Verified registry unavailable: ${error.message}`); });
  function favorites() { try { return JSON.parse(localStorage.getItem('perp-canary/favorites/v1') || '[]'); }
    catch { return []; } }
  function renderRadar() {
    const sort = $('radar-sort').value, filter = $('radar-filter').value, favoriteSet = new Set(favorites());
    const data = [...registry.values()].map(market => {
      const snapshot = snapshots.get(market.symbol)?.value;
      return { market, snapshot, quality: marketScore(snapshot, market) };
    }).filter(row => filter !== 'favorites' || favoriteSet.has(row.market.symbol))
      .filter(row => filter !== 'fresh' || row.quality.score !== null);
    const metric = row => sort === 'score' ? row.quality.score : sort === 'spread' ? row.quality.spreadBps :
      sort === 'freshness' ? Date.parse(row.snapshot?.book?.observedAt ?? '') :
        sort === 'liquidity' ? Math.min(row.quality.bidDepth ?? 0, row.quality.askDepth ?? 0) :
      sort === 'activity' ? sourceTime(row.market.lastTradeAt) :
            row.market.fundingRateWindowPercent == null ? null : Math.abs(Number(row.market.fundingRateWindowPercent));
    data.sort((a, b) => {
      const av = metric(a), bv = metric(b); if (av == null || Number.isNaN(av)) return 1;
      if (bv == null || Number.isNaN(bv)) return -1;
      return sort === 'spread' ? av - bv : bv - av;
    });
    $('radar-rows').replaceChildren(...data.map(({ market, snapshot, quality }) => {
      const tr = document.createElement('tr');
      const age = snapshot?.book?.observedAt ? Math.round((Date.now() - Date.parse(snapshot.book.observedAt)) / 1000) : null;
      const bookFresh = snapshot?.book?.status === 'TRUSTED' && age !== null && age >= 0 && age <= 30;
      const activityAt = sourceTime(market.lastTradeAt);
      const cells = [market.symbol, snapshot?.mark || market.lastIndexedPrice ?
        Number(snapshot?.mark ?? market.lastIndexedPrice).toLocaleString('en-US', { maximumSignificantDigits: 8 }) : 'Unavailable',
        bookFresh ? `${snapshot.book.bid} / ${snapshot.book.ask}` : 'Unavailable',
        quality.spreadBps == null ? 'Unavailable' : `${quality.spreadBps.toFixed(2)} bps`,
        quality.bidDepth == null ? 'Unavailable' : `${quality.bidDepth.toFixed(4)} / ${quality.askDepth.toFixed(4)} ${market.base}`,
        activityAt === null ? 'Unavailable' : new Date(activityAt).toLocaleString(),
        market.fundingRateWindowPercent == null ? 'Unavailable' : `${Number(market.fundingRateWindowPercent).toFixed(4)}%`,
        'Unavailable / Unavailable', bookFresh ? `TRUSTED · ${age}s` :
          snapshot?.book?.status === 'TRUSTED' ? `STALE · ${age}s` :
          snapshots.get(market.symbol)?.error ?? 'Not scanned',
        quality.score == null ? 'Unscored' : `${quality.score}/100`];
      for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      tr.children[9].title = quality.reason;
      const action = document.createElement('td'), button = document.createElement('button');
      button.className = 'button secondary'; button.type = 'button'; button.textContent = 'Inspect market';
      button.disabled = ![...$('market-select').options].some(option => option.value === market.symbol);
      if (button.disabled) button.title = 'Current verified market registry is required before opening this market.';
      button.onclick = () => { $('market-select').value = market.symbol;
        $('market-select').dispatchEvent(new Event('change', { bubbles: true })); switchTo('terminal'); };
      action.append(button); tr.append(action); return tr;
    }));
    if (!scanning) txt('radar-progress', `${registry.size} verified PERP markets; ${[...snapshots.values()].filter(row => row.value).length} quote snapshots. Scan is manual and limited to two concurrent reads.`);
  }
  async function sampleMarket(symbol, force = false) {
    const old = snapshots.get(symbol);
    if (!force && old?.value && Date.now() - old.at < 20_000) return old.value;
    if (pendingSamples.has(symbol)) return pendingSamples.get(symbol);
    const task = (async () => {
      try { const value = await read(`/api/v1/markets/snapshot?market=${encodeURIComponent(symbol)}`, 25_000);
        if (value.market !== symbol || value.chainId !== 50383) throw Error('Market or chain mismatch');
        snapshots.set(symbol, { value, at: Date.now() }); evaluateForMarket(symbol, value); return value;
      } catch (error) { snapshots.set(symbol, { value: null, error: `Unavailable: ${error.message}`, at: Date.now() });
        evaluateForMarket(symbol, null); return null; }
    })();
    pendingSamples.set(symbol, task);
    try { return await task; } finally { pendingSamples.delete(symbol); }
  }
  async function scanAll() {
    if (scanning || !registry.size) return;
    scanning = true; const serial = ++scanSerial, symbols = [...registry.keys()]; let next = 0, completed = 0;
    $('radar-scan').disabled = true;
    const worker = async () => { while (next < symbols.length && serial === scanSerial) {
      const symbol = symbols[next++]; await sampleMarket(symbol, true); completed++;
      txt('radar-progress', `${completed}/${symbols.length} verified markets checked; partial failures stay visible.`);
      renderRadar();
    } };
    try { await Promise.all([worker(), worker()]); }
    finally { scanning = false; $('radar-scan').disabled = false; renderRadar(); }
  }
  $('radar-scan').onclick = scanAll;
  $('radar-sort').onchange = renderRadar; $('radar-filter').onchange = renderRadar;
  const alertTypes = new Set(['PRICE_ABOVE', 'PRICE_BELOW', 'SPREAD_ABOVE', 'FEED_STALE', 'FEED_RECOVERED', 'FUNDING_ABOVE']);
  function renderAlerts() {
    const unread = storage(eventKey, []).filter(event => event.scope === alertScope && !event.acknowledged).length;
    $('workspace-alerts').textContent = unread ? `Alerts (${unread})` : 'Alerts';
    $('alerts-list').replaceChildren(...rows().map(alert => {
      const card = document.createElement('div'); card.className = 'product-alert';
      const summary = document.createElement('p');
      summary.textContent = `${alert.enabled ? 'ACTIVE' : 'PAUSED'} · ${alert.market} · ${alert.type}${alert.threshold ? ` ${alert.threshold}` : ''} · ${alert.status ?? 'NOT EVALUATED'} · source ${alert.source ?? 'NONE'} · checked ${alert.evaluatedAt ?? 'never'} · triggered ${alert.triggeredAt ?? 'never'}`;
      card.append(summary);
      for (const [name, action] of [['Edit', () => { editAlertId = alert.id; $('alert-market').value = alert.market;
        $('alert-type').value = alert.type; $('alert-threshold').value = alert.threshold ?? '';
        $('alert-save').textContent = 'Save alert'; $('alert-cancel-edit').hidden = false; }],
      [alert.enabled ? 'Pause' : 'Enable', () => changeAlert(alert.id, row => ({ ...row, enabled: !row.enabled }))],
      ['Delete', () => { saveAlerts(rows().filter(row => row.id !== alert.id)); renderAlerts(); }]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary';
        button.textContent = name; button.onclick = action; card.append(button);
      } return card;
    }));
    $('alert-events').replaceChildren(...storage(eventKey, []).filter(event => event.scope === alertScope).slice(0, 100).map(event => {
      const p = document.createElement('p'); p.textContent = `${event.at} · ${event.market} · ${event.type} · ${event.value} · ${event.source}${event.acknowledged ? ' · acknowledged' : ''}`;
      if (!event.acknowledged) { const button = document.createElement('button'); button.className = 'button secondary';
        button.type = 'button'; button.textContent = 'Acknowledge'; button.onclick = () => {
          const events = storage(eventKey, []); const found = events.find(row => row.id === event.id);
          if (found) found.acknowledged = true; save(eventKey, events); renderAlerts(); }; p.append(button); }
      return p;
    }));
    if (!$('alerts-list').children.length) txt('alerts-status', 'No alerts yet. Create a rule; evaluation requires this browser tab to remain open.');
  }
  function changeAlert(id, change) { saveAlerts(rows().map(row => row.id === id ? change(row) : row)); renderAlerts(); }
  $('alert-type').onchange = () => { const health = $('alert-type').value.startsWith('FEED_');
    $('alert-threshold').disabled = health; if (health) $('alert-threshold').value = ''; };
  $('alert-cancel-edit').onclick = () => { editAlertId = null; $('alert-form').reset();
    $('alert-save').textContent = 'Create alert'; $('alert-cancel-edit').hidden = true; $('alert-threshold').disabled = false; };
  $('alert-form').onsubmit = async event => {
    event.preventDefault(); await refreshAlertScope();
    const market = $('alert-market').value, type = $('alert-type').value;
    const threshold = $('alert-threshold').value.trim();
    if (!registry.has(market) || !alertTypes.has(type) ||
      (!type.startsWith('FEED_') && (!/^\d+(?:\.\d+)?$/.test(threshold) || Number(threshold) <= 0))) {
      txt('alerts-status', 'Choose a verified market and a positive threshold for this condition.'); return;
    }
    const all = rows(), old = all.find(row => row.id === editAlertId);
    const record = { id: old?.id ?? crypto.randomUUID(), scope: alertScope, market, type, threshold, enabled: true,
      lastValue: null, status: 'NOT EVALUATED', evaluatedAt: null, triggeredAt: old?.triggeredAt ?? null,
      triggeredAtMs: old?.triggeredAtMs ?? 0, source: 'NONE' };
    saveAlerts(old ? all.map(row => row.id === old.id ? record : row) : [record, ...all].slice(0, 100));
    $('alert-cancel-edit').click(); renderAlerts(); txt('alerts-status', `Saved ${market} ${type}. Open-tab monitoring is active.`);
  };
  function evaluateForMarket(symbol, sample) {
    const all = rows(); let changed = false, events = storage(eventKey, []);
    for (const alert of all) if (alert.enabled && alert.market === symbol) {
      const result = evaluateAlert(alert, sample); alert.status = result.status;
      alert.evaluatedAt = new Date().toISOString(); alert.source = sample?.book?.source ?? 'MARKET_UNAVAILABLE';
      if (result.value !== null) alert.lastValue = result.value;
      if (result.triggered) { alert.triggeredAt = alert.evaluatedAt; alert.triggeredAtMs = Date.now();
        events = [{ id: crypto.randomUUID(), scope: alertScope, at: alert.triggeredAt, market: symbol,
          type: alert.type, value: result.value, source: alert.source, acknowledged: false }, ...events].slice(0, 200); }
      changed = true;
    }
    if (changed) { saveAlerts(all); save(eventKey, events); renderAlerts(); }
  }
  async function checkAlerts() {
    await refreshAlertScope();
    const symbols = [...new Set(rows().filter(row => row.enabled).map(row => row.market))];
    $('alerts-check').disabled = true; txt('alerts-status', `Checking ${symbols.length} alert markets with at most two concurrent reads…`);
    let next = 0; const worker = async () => { while (next < symbols.length) await sampleMarket(symbols[next++], true); };
    try { await Promise.all([worker(), worker()]); txt('alerts-status', `Checked ${symbols.length} markets at ${new Date().toLocaleTimeString()}. Monitoring runs only while this tab is open.`); }
    finally { $('alerts-check').disabled = false; }
  }
  $('alerts-check').onclick = checkAlerts;
  setInterval(() => { if (document.visibilityState === 'visible' && rows().some(row => row.enabled)) checkAlerts(); }, 60_000);
  async function walletIdentity() {
    if (!window.ethereum?.request) return null;
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({ method: 'eth_accounts' }), window.ethereum.request({ method: 'eth_chainId' })]);
    return Number(chain) === 50383 && Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0] ?? '') ?
      accounts[0].toLowerCase() : null;
  }
  async function refreshAlertScope() {
    try { alertScope = await walletIdentity() ?? 'anonymous'; }
    catch { alertScope = 'anonymous'; }
    renderAlerts();
  }
  refreshAlertScope();
  function renderJournal() {
    const status = $('journal-status-filter').value, since = $('journal-date-filter').value,
      evidence = $('journal-evidence-filter').value;
    const filtered = journalRows.filter(row => status === 'all' || row.status === status)
      .filter(row => !since || (row.endedAt ?? '').slice(0, 10) >= since)
      .filter(row => evidence === 'all' || (evidence === 'verified' ? row.verified : !row.verified));
    visibleJournalRows = filtered;
    $('journal-rows').replaceChildren(...filtered.map(row => {
      const tr = document.createElement('tr');
      for (const value of [row.market, row.side, row.id, row.status, row.originalQuantity,
        row.filledQuantity, row.price, row.executionPrice ?? 'Unavailable', row.liquidityRole ?? 'Unavailable',
        row.fees ?? 'Unavailable', row.positionImpact ?? 'Unavailable', row.endedAt ?? 'Unavailable',
        row.placedTxHash ? `${row.placedTxHash.slice(0, 12)}…${row.fillTxHash ? ` / ${row.fillTxHash.slice(0, 12)}…` : ''}` : 'Unavailable',
        row.verified ? 'VERIFIED RECEIPTS + EVENTS' : 'SDK INDEXER · may lag']) {
        const td = document.createElement('td'); td.textContent = label(value); tr.append(td);
      }
      tr.children[12].title = `${row.placedTxHash ?? 'no placement hash'} · ${row.fillTxHash ?? 'no verified fill hash'}`;
      const td = document.createElement('td'); if (row.verified) {
        const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = 'Execution Replay';
        button.onclick = () => { switchTo('terminal'); $('account-tab-button-replay')?.click(); };
        td.append(button);
      } tr.append(td); return tr;
    }));
    const filled = journalRows.filter(row => row.status === 'Filled' && Number(row.filledQuantity) > 0);
    txt('journal-analytics', `${$('market-select').value} indexed filled-order quantity: ${filled.reduce((sum, row) => sum + Number(row.filledQuantity), 0).toFixed(8)} ${$('market-select').value.replace('-PERP', '')} (not USD volume). Fees, execution quality, realized PnL and win/loss: unavailable without complete fill and fee reconciliation.`);
    $('journal-export').disabled = !filtered.length;
  }
  async function loadJournal(more = false) {
    if (journalBusy) return;
    let account; try { account = await walletIdentity(); }
    catch { account = null; }
    if (!account) { txt('journal-status', 'Connect a wallet on Hideki 50383. No account history is read without a selected wallet.'); return; }
    const mode = $('mode-delegated')?.getAttribute('aria-pressed') === 'true' ? 'DELEGATED_PERPS' : 'DIRECT';
    const market = $('market-select').value, identity = `${account}:${mode}:${market}`;
    if (!more || identity !== journalIdentity) { journalRows = []; journalOffset = 0; journalNext = null; journalIdentity = identity; }
    journalBusy = true; $('journal-load').disabled = true; $('journal-more').disabled = true;
    txt('journal-status', `Reading ${market} official SDK indexer page at offset ${journalOffset}…`);
    try { const result = await read(`/api/v1/trade/history?account=${encodeURIComponent(account)}&mode=${mode}&market=${encodeURIComponent(market)}&offset=${journalOffset}`, 26_000);
      if (identity !== journalIdentity || await walletIdentity() !== account || $('market-select').value !== market) return;
      journalRows = mergeOrderPages(journalRows, result.rows.map(row => ({ ...row, market, verified: false })));
      journalNext = result.nextOffset ?? null; journalOffset = journalNext ?? journalOffset;
      if (mode === 'DELEGATED_PERPS' && market === 'BTC-PERP' && account === '0x6fa3659a15e9264e43ec67fe4bb5d31d38109a42') {
        try { const replay = await read('/api/v1/execution/replay?orderId=14978756187852164141712');
          if (replay.orderId === '14978756187852164141712') {
            journalRows = mergeOrderPages(journalRows, [{ id: replay.orderId, market, side: 'BUY', status: 'Filled',
              originalQuantity: '0.00013', filledQuantity: '0.00013', price: '80880',
              endedAt: replay.indexedEndedAt ?? null, placedTxHash: replay.placementHash, fillTxHash: replay.fillHash,
              executionPrice: replay.verifiedFillPrice, liquidityRole: 'MAKER',
              positionImpact: 'Only 0.00013 BTC increment', verified: true }]);
          }
        } catch { /* indexer rows remain available without replay */ }
      }
      txt('journal-status', `${journalRows.length} distinct orders for ${mode === 'DELEGATED_PERPS' ? 'Wallet 1 via ' : ''}${account}; ${journalNext == null ? 'last page reached' : 'more pages available'}. Indexer can lag live chain state.`);
      renderJournal();
    } catch (error) { txt('journal-status', `History unavailable: ${error.message}. Verified Execution Replay remains separate. Retry this page.`); }
    finally { journalBusy = false; $('journal-load').disabled = false; $('journal-more').disabled = journalNext == null; }
  }
  $('journal-load').onclick = () => loadJournal(false); $('journal-more').onclick = () => loadJournal(true);
  for (const id of ['journal-status-filter', 'journal-date-filter', 'journal-evidence-filter']) $(id).onchange = renderJournal;
  $('journal-export').onclick = () => {
    const headers = ['market', 'side', 'orderId', 'status', 'requestedQuantity', 'filledQuantity', 'limitPrice',
      'executionPrice', 'liquidityRole', 'fees', 'positionImpact', 'endedAt', 'placedTxHash', 'fillTxHash', 'evidence'];
    const csv = [headers, ...visibleJournalRows.map(row => [row.market, row.side, row.id, row.status, row.originalQuantity,
      row.filledQuantity, row.price, row.executionPrice, row.liquidityRole, row.fees, row.positionImpact,
      row.endedAt, row.placedTxHash, row.fillTxHash,
      row.verified ? 'VERIFIED_RECEIPTS_EVENTS' : 'SDK_INDEXER_NONFINAL'])]
      .map(record => record.map(value => `"${String(value ?? '').replace(/^[-=+@]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = href; link.download = 'perp-canary-journal.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
})();
