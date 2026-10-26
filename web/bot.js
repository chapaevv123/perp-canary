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
  const btc = raw => (Number(raw) / 1e8).toFixed(8);
  const usd = raw => (Number(raw) / 1e18).toFixed(2);
  function rawBtc(value) {
    if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw Error('BTC quantity needs at most 8 decimal places');
    return BigInt(value.split('.')[0] + (value.split('.')[1] || '').padEnd(8, '0')).toString();
  }
  async function loadOrders() {
    try {
      const result = await json('/api/v1/bot-orders');
      const position = result.position;
      node('activePosition').textContent = `LIVE READ-ONLY · order block ${result.block} · Wallet 1 ${result.owner} · size ${btc(position.sizeRaw)} BTC · entry ${usd(position.entryPriceRaw)} USDso · mark ${position.markPriceRaw ? usd(position.markPriceRaw) : 'UNKNOWN'} · liquidation ${position.liquidationPriceRaw ? usd(position.liquidationPriceRaw) : 'UNKNOWN'} · price PnL ${position.pnlRaw ? usd(position.pnlRaw) : 'UNKNOWN'} USDso · analytics block ${position.analyticsBlock || 'UNKNOWN'}`;
      node('openOrders').textContent = result.orders.length ?
        `LIVE READ-ONLY · ${result.orders.map(order => `ID ${order.id}, ${order.side}, remaining ${btc(order.remainingRaw)} BTC, limit ${usd(order.priceRaw)}, expiry ns ${order.expiryNs}`).join(' | ')}` :
        `LIVE READ-ONLY · block ${result.block} · no resting BTC-PERP orders for Wallet 1`;
      node('closePosition').textContent = `${result.closePosition.status} · ${result.closePosition.reason}`;
      node('canaryRisk').textContent = `${result.canary.verdict} · ${result.canary.primary || 'NONE'} · ${result.canary.saferAction}`;
    } catch (error) {
      node('activePosition').textContent = `UNKNOWN · ${error.message}`;
      node('openOrders').textContent = 'UNKNOWN · on-chain order discovery unavailable';
      node('canaryRisk').textContent = 'AMBER · UNVERIFIED_STATE · Repeat read-only checks';
    }
  }
  node('refreshOrders').onclick = loadOrders;
  async function planAction(operation) {
    const id = node(operation === 'CANCEL' ? 'cancelOrderId' : 'reduceOrderId').value.trim();
    const newRemainingRaw = operation === 'CANCEL' ? null : rawBtc(node('reduceRemaining').value.trim());
    const plan = await json('/api/v1/bot-order-action', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, orderId: id, newRemainingRaw }) });
    node('orderActionState').textContent = `${plan.status} · ${operation} order ${id} · Canary ${plan.canary.verdict}: ${plan.canary.primary || 'NONE'} · ${plan.blockers.join('; ') || 'All plan-time checks passed; local CLI rechecks'} · SHA-256 ${plan.hash}`;
    await loadExecution(); await loadOrders();
  }
  node('cancelOrderForm').onsubmit = async event => {
    event.preventDefault();
    try { await planAction('CANCEL'); } catch (error) { node('orderActionState').textContent = `BLOCKED · ${error.message}`; }
  };
  node('reduceOrderForm').onsubmit = async event => {
    event.preventDefault();
    try { await planAction('REDUCE_ORDER'); } catch (error) { node('orderActionState').textContent = `BLOCKED · ${error.message}`; }
  };
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
        const action = plan.schema === 'perp-canary/order-action-plan/v1';
        for (const [label, value] of [['Status', displayedStatus], ['Operation', plan.operation], ['Plan hash', plan.hash],
          ['Canary risk', `${row.canary.verdict}: ${row.canary.primary || 'NONE'}; ${row.canary.saferAction}`],
          ['Network', `Hideki ${plan.chainId}`], ['Owner / bot', `${plan.owner} / ${plan.operator}`],
          ['Market / side', `BTC-PERP ${action ? plan.before?.side || 'UNKNOWN' : plan.side}`],
          ['Order', action ? `ID ${plan.orderId}, remaining ${plan.before?.remainingRaw || 'UNKNOWN'} raw, next ${plan.newRemainingRaw || 'CANCEL'}` : `${plan.price} / ${plan.quantity}`],
          ['Gas / collateral', `${plan.risk.maxGasCostWei} wei max / ${action ? 'position unaffected by resting order maintenance' : `${plan.risk.marginBankUnlocked} USDso at plan`}`],
          ['Checks', Object.entries(plan.checks).map(([key, ok]) =>
            `${key}:${ok ? 'PASS' : plan.diagnostic?.blockedDependencies.includes(key) ? 'BLOCKED BY PRIMARY ERROR' : 'FAILED'}`).join(', ')],
          ['Simulation', plan.checks.simulation ? 'SUPPORTED' : 'BLOCKED'], ['Expiry', plan.expiresAt],
          ['PRIMARY ERROR', plan.diagnostic?.primaryError || 'NONE'],
          ['BLOCKED DEPENDENCIES', plan.diagnostic?.blockedDependencies.join(', ') || 'NONE'],
          ['RPC / contract revert', plan.diagnostic?.failure ?
            `${plan.diagnostic.failure.category}; RPC ${plan.diagnostic.failure.rpcCode ?? 'UNKNOWN'}; selector ${plan.diagnostic.failure.selector || 'UNKNOWN'}; ${plan.diagnostic.failure.details}; best ask ${plan.diagnostic.failure.bestAsk || 'UNKNOWN'}` : 'NONE'],
          ['Recommended next action', plan.diagnostic?.nextAction || 'Review all failed gates and create a fresh plan'],
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
      const primary = plan.diagnostic ? `PRIMARY ERROR: ${plan.diagnostic.primaryError}\nBLOCKED DEPENDENCIES: ${plan.diagnostic.blockedDependencies.join(', ')}\nRPC / contract revert: ${plan.diagnostic.failure.category} ${plan.diagnostic.failure.selector || ''}; best ask ${plan.diagnostic.failure.bestAsk || 'UNKNOWN'}\nNEXT: ${plan.diagnostic.nextAction}` : plan.blockers.join('; ');
      node('botPlanState').textContent = `${plan.status}\nCanary ${plan.canary.verdict}: ${plan.canary.primary || 'NONE'}\n${primary}\nPlan SHA-256: ${plan.hash}`;
      await loadExecution();
    } catch (error) { node('botPlanState').textContent = `BLOCKED · ${error.message}`; }
  };
  refresh();
  loadOrders();
  loadExecution();
})();
