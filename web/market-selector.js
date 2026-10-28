(() => {
  const native = document.getElementById('market-select');
  const picker = native.closest('.market-picker');
  const trigger = document.createElement('button');
  trigger.id = 'open-market-selector'; trigger.type = 'button'; trigger.className = 'market-selector-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'market-dialog');
  picker.after(trigger);
  picker.classList.add('market-native-picker');
  native.tabIndex = -1;

  const dialog = document.createElement('dialog'); dialog.id = 'market-dialog'; dialog.className = 'market-dialog';
  dialog.setAttribute('aria-label', 'Choose a perpetual market');
  dialog.innerHTML = `<div class="market-dialog-head"><div><span class="eyebrow">PERP CANARY / MARKETS</span><h2>Select a perpetual</h2><p>Verified SDK and factory markets. Spot is separate and is not tradable here.</p></div><button id="close-market-selector" type="button" aria-label="Close market selector">✕</button></div>
    <label class="market-search-label" for="market-search">Search markets</label><input id="market-search" type="search" autocomplete="off" placeholder="Search BTC, ETH, SOL…">
    <div class="market-filter" role="tablist" aria-label="Market filter"><button type="button" role="tab" data-filter="all" aria-selected="true">All Perps</button><button type="button" role="tab" data-filter="favorites" aria-selected="false">Favorites</button><button type="button" role="tab" data-filter="recent" aria-selected="false">Recently viewed</button></div>
    <div class="market-table-head" aria-hidden="true"><span>Market</span><span>Last indexed fill</span><span>24h change</span><span>24h volume</span><span>Open interest</span><span>Funding / window</span><span>Save</span></div>
    <div id="market-list" class="market-list" role="listbox" aria-label="Verified perp markets"></div><p class="market-disclaimer">Last fill and funding are indexer values and may lag. A market is selectable for viewing; placing an order requires a fresh trusted book, wallet eligibility and Canary Guard review. 24h metrics are unavailable until verified history supports them.</p>`;
  document.body.append(dialog);
  const search = dialog.querySelector('#market-search');
  const list = dialog.querySelector('#market-list');
  let markets = [], filter = 'all';
  const key = 'perp-canary/favorites/v1', recentKey = 'perp-canary/recent/v1';
  const saved = name => { try { const value = JSON.parse(window.localStorage.getItem(name) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && /^[A-Z0-9]{2,16}-PERP$/.test(item)) : [];
  } catch { return []; } };
  let favorites = saved(key), recent = saved(recentKey);
  const store = (name, value) => { try { window.localStorage.setItem(name, JSON.stringify(value)); } catch { /* storage optional */ } };
  const format = value => value == null ? 'Unavailable' : Number(value).toLocaleString('en-US', { maximumSignificantDigits: 8 });
  function current() { return markets.find(row => row.symbol === native.value); }
  function updateTrigger() {
    const row = current();
    trigger.textContent = `${native.value || 'Select market'}  ▾`;
    trigger.title = row ? `${row.symbol} · ${row.status === 'TRADEABLE' ? 'Pool active; account eligibility checked on review' : `View only: ${row.status}`}` :
      'Browse verified perp markets';
  }
  function rows() {
    const query = search.value.trim().toUpperCase();
    return markets.filter(row => row.symbol.includes(query) &&
      (filter === 'favorites' ? favorites.includes(row.symbol) : filter === 'recent' ? recent.includes(row.symbol) : true))
      .sort((a, b) => filter === 'recent' ? recent.indexOf(a.symbol) - recent.indexOf(b.symbol) :
        a.symbol === 'BTC-PERP' ? -1 : b.symbol === 'BTC-PERP' ? 1 : a.symbol.localeCompare(b.symbol));
  }
  function render() {
    const selected = rows();
    const elements = selected.map(row => {
      const item = document.createElement('div'); item.className = 'market-list-row';
      if (row.symbol === native.value) item.classList.add('active');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'market-row-select';
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(row.symbol === native.value));
      button.dataset.symbol = row.symbol;
      const symbol = document.createElement('strong'); symbol.textContent = row.symbol;
      const sub = document.createElement('small'); sub.textContent = `${row.status === 'TRADEABLE' ? 'POOL ACTIVE' : `VIEW ONLY · ${row.status}`} · ${row.quote} · up to ${row.maxLeverage ?? '—'}×`;
      const first = document.createElement('span'); first.append(symbol, sub);
      const cells = [format(row.lastIndexedPrice), 'Unavailable', 'Unavailable',
        row.openInterestBase == null ? 'Unavailable' : `${format(row.openInterestBase)} ${row.base}`,
        row.fundingRateWindowPercent == null ? 'Unavailable' : `${format(row.fundingRateWindowPercent)}%`];
      button.append(first, ...cells.map(value => { const cell = document.createElement('span'); cell.textContent = value; return cell; }));
      button.onclick = () => {
        if (native.value !== row.symbol) {
          native.value = row.symbol;
          native.dispatchEvent(new Event('change', { bubbles: true }));
        }
        recent = [row.symbol, ...recent.filter(value => value !== row.symbol)].slice(0, 6);
        store(recentKey, recent); updateTrigger(); dialog.close();
      };
      const star = document.createElement('button'); star.type = 'button'; star.className = 'market-favorite';
      star.setAttribute('aria-label', `${favorites.includes(row.symbol) ? 'Remove' : 'Add'} ${row.symbol} ${favorites.includes(row.symbol) ? 'from' : 'to'} favorites`);
      star.setAttribute('aria-pressed', String(favorites.includes(row.symbol)));
      star.textContent = favorites.includes(row.symbol) ? '★' : '☆';
      star.onclick = () => { favorites = favorites.includes(row.symbol) ? favorites.filter(value => value !== row.symbol) : [...favorites, row.symbol];
        store(key, favorites); render(); };
      item.append(button, star); return item;
    });
    list.replaceChildren(...elements);
    if (!elements.length) list.textContent = markets.length ? 'No markets match this search or filter.' :
      'Market discovery is unavailable. Check the connection details and retry.';
  }
  trigger.onclick = () => { updateTrigger(); render(); dialog.showModal(); search.focus(); search.select(); };
  dialog.querySelector('#close-market-selector').onclick = () => dialog.close();
  dialog.addEventListener('close', () => trigger.focus());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  search.oninput = render;
  dialog.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => {
    filter = button.dataset.filter;
    dialog.querySelectorAll('[data-filter]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    render(); search.focus();
  }; });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { dialog.close(); return; }
    const options = [...list.querySelectorAll('.market-row-select')];
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); options[(currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
    } else if (event.key === 'Home') { event.preventDefault(); options[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); options.at(-1)?.focus(); }
  });
  native.addEventListener('change', updateTrigger);
  window.addEventListener('canary:markets', event => { markets = Array.isArray(event.detail) ? event.detail.filter(row => row.marketType === 'PERP') : [];
    favorites = favorites.filter(symbol => markets.some(row => row.symbol === symbol));
    recent = recent.filter(symbol => markets.some(row => row.symbol === symbol));
    updateTrigger(); render(); });
  if (Array.isArray(window.__canaryMarkets)) {
    markets = window.__canaryMarkets.filter(row => row.marketType === 'PERP');
    render();
  }
  updateTrigger();
})();
