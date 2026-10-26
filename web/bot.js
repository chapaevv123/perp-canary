(() => {
  const node = id => document.getElementById(id);
  const fact = (table, label, value) => {
    const row = document.createElement('tr');
    for (const item of [label, value]) { const cell = document.createElement('td'); cell.textContent = String(item); row.append(cell); }
    table.append(row);
  };
  async function json(url, options) {
    const response = await fetch(url, options);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('Local server returned a non-JSON response');
    const value = await response.json();
    if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
    return value;
  }
  async function refresh() {
    node('botPlanButton').disabled = true;
    node('botState').textContent = 'Reading local public metadata and Hideki permissions…';
    node('botFacts').replaceChildren();
    try {
      const result = await json('/api/v1/bot-connection');
      node('botState').textContent = `${result.status} · ${result.nextAction}`;
      const table = document.createElement('table');
      for (const [label, value] of [['Bot wallet status', result.status], ['Public bot address', result.address || 'NOT_CONFIGURED'],
        ['Network', `${result.network} ${result.chainId}`], ['Gas balance (STT)', result.gasStt],
        ['Trading wallet', result.tradingWallet], ['Allowed markets', result.allowedMarkets.join(', ') || 'UNKNOWN'],
        ['Permission expiry', result.permissionExpiry], ['Revocation status', result.revocationStatus],
        ['Sampled block', result.sampledBlock || 'UNKNOWN']]) fact(table, label, value);
      for (const [name, grant] of Object.entries(result.permissions || {})) fact(table, `${name} effective permission`, `${grant.effective.status} · ${grant.effective.value}`);
      node('botFacts').append(table);
      node('botPlanButton').disabled = result.status !== 'ON_CHAIN_LINK_OBSERVED';
    } catch (error) { node('botState').textContent = `UNKNOWN · ${error.message}`; }
  }
  node('refreshBot').onclick = refresh;
  async function loadExecution() {
    const box = node('executionRows');
    box.replaceChildren();
    try {
      const result = await json('/api/v1/bot-execution');
      node('executionState').textContent = `${result.rows.length} saved M3.3 plan(s) · local CLI execution only`;
      for (const row of [...result.rows].reverse()) {
        const plan = row.plan;
        const wrapper = document.createElement('div');
        wrapper.className = 'record';
        const last = row.history.at(-1);
        const displayedStatus = last?.state || (plan.status === 'PREPARED' ?
          Date.now() >= Date.parse(plan.expiresAt) ? 'EXPIRED' : 'PREPARED AT SNAPSHOT; LOCAL RECHECK REQUIRED' : plan.status);
        for (const [label, value] of [['Status', displayedStatus], ['Plan hash', plan.hash],
          ['Network', `Hideki ${plan.chainId}`], ['Owner / bot', `${plan.owner} / ${plan.operator}`],
          ['Market / side', `BTC-PERP ${plan.side}`], ['Price / quantity', `${plan.price} / ${plan.quantity}`],
          ['Gas / collateral', `${plan.risk.maxGasCostWei} wei max / ${plan.risk.marginBankUnlocked} USDso at plan`],
          ['Checks', Object.entries(plan.checks).map(([key, ok]) => `${key}:${ok}`).join(', ')],
          ['Simulation', plan.checks.simulation ? 'SUPPORTED' : 'BLOCKED'], ['Expiry', plan.expiresAt],
          ['Blockers', plan.blockers.join('; ') || 'None at plan time; local preflight repeats all checks'],
          ['Transaction', last?.txHash || 'NONE']]) {
          const p = document.createElement('p'); p.className = 'small mono'; p.textContent = `${label}: ${value}`; wrapper.append(p);
        }
        for (const forensic of row.forensic) {
          const link = document.createElement('a');
          link.href = `/api/v1/bot-evidence/${forensic.hash}`;
          link.textContent = `${forensic.verdict} evidence ${forensic.hash}`;
          wrapper.append(link);
        }
        box.append(wrapper);
      }
    } catch (error) { node('executionState').textContent = `UNKNOWN · ${error.message}`; }
  }
  node('refreshExecution').onclick = loadExecution;
  node('botPlanForm').onsubmit = async event => {
    event.preventDefault();
    node('botPlanState').textContent = 'Running read-only Hideki preflight…';
    try {
      const plan = await json('/api/v1/bot-plan', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ side: node('botSide').value, price: node('botPrice').value.trim(),
          quantity: node('botQuantity').value.trim() }) });
      node('botPlanState').textContent = `${plan.status} · ${plan.blockers.join('; ')} · plan SHA-256 ${plan.hash}`;
      await loadExecution();
    } catch (error) { node('botPlanState').textContent = `BLOCKED · ${error.message}`; }
  };
  refresh();
  loadExecution();
})();
