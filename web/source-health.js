(() => {
  const select = document.getElementById('market-select');
  const host = document.createElement('div'); host.id = 'source-health'; host.className = 'source-health';
  host.innerHTML = '<div class="source-chips" role="status" aria-live="polite">Checking market connections…</div><details><summary>Connection details</summary><div class="source-details"></div></details>';
  document.querySelector('.head-actions').append(host);
  let requestId = 0;
  const names = { rpc: 'RPC', websocket: 'WebSocket', indexer: 'Indexer', pool: 'Pool' };
  const safe = value => value?.status === 'HEALTHY' ? 'live' : value?.status === 'DEGRADED' ? 'limited' : 'offline';
  async function refresh() {
    const id = ++requestId, market = select.value;
    host.querySelector('.source-chips').textContent = 'Checking market connections…';
    const controller = new window.AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`/api/v1/health/sources?market=${encodeURIComponent(market)}`,
        { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error(`Health check HTTP ${response.status}`);
      const data = await response.json();
      if (id !== requestId || market !== select.value) return;
      const chips = Object.entries(names).map(([key, name]) => {
        const item = document.createElement('span');
        item.className = `source-chip ${safe(data[key])}`;
        item.textContent = `${name} ${safe(data[key])}`;
        return item;
      });
      host.querySelector('.source-chips').replaceChildren(...chips);
      const rows = Object.entries(names).map(([key, name]) => {
        const row = document.createElement('p');
        row.textContent = `${name}: ${data[key]?.detail || 'No source result'}${data[key]?.block ? ` · block ${data[key].block}` : ''}`;
        return row;
      });
      host.querySelector('.source-details').replaceChildren(...rows);
      host.dataset.overall = data.rpc?.status === 'HEALTHY' && data.websocket?.status === 'HEALTHY' &&
        data.indexer?.status === 'HEALTHY' && data.pool?.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
    } catch (error) {
      if (id !== requestId) return;
      host.querySelector('.source-chips').textContent = 'Connection check unavailable';
      host.querySelector('.source-details').textContent = `The local health check did not complete: ${error.message}. Refresh to retry.`;
      host.dataset.overall = 'UNAVAILABLE';
    } finally { window.clearTimeout(timer); }
  }
  select.addEventListener('change', refresh);
  document.getElementById('refresh').addEventListener('click', refresh);
  window.addEventListener('canary:markets', refresh);
  window.setInterval(refresh, 30_000);
  refresh();
})();
