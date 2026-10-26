/* Browser-only EIP-1193 wallet controller. No keys, background sends, or auto-retries. */
(() => {
  const byId = id => document.getElementById(id);
  const providers = new Map();

  function invalidate(message) {
    byId('reviewWallet').hidden = true;
    if (message) byId('sendState').textContent = message;
  }
  function addProvider(key, name, provider) {
    if (!provider || typeof provider.request !== 'function' || providers.has(key)) return;
    providers.set(key, provider);
    const select = byId('walletProvider');
    if (providers.size === 1) select.replaceChildren();
    const option = document.createElement('option');
    option.value = key;
    option.textContent = name;
    select.append(option);
    if (providers.size === 1) select.value = key;
  }
  window.addEventListener('eip6963:announceProvider', event => {
    const detail = event.detail;
    if (detail?.info?.rdns && detail?.provider) {
      addProvider(detail.info.uuid || detail.info.rdns, detail.info.name || detail.info.rdns, detail.provider);
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    const injected = window.ethereum;
    if (injected?.providers?.length) {
      injected.providers.forEach((provider, index) => addProvider('legacy-' + index,
        provider.isRabby ? 'Rabby' : provider.isMetaMask ? 'MetaMask' : 'Wallet ' + (index + 1), provider));
    } else if (injected) {
      addProvider('injected', injected.isRabby ? 'Rabby' : injected.isMetaMask ? 'MetaMask' : 'Injected wallet', injected);
    }
  }, 350);

  async function chainId(provider) { return Number(await provider.request({ method: 'eth_chainId' })); }
  async function api(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'HTTP ' + response.status);
      error.code = result.code || 'REQUEST_FAILED';
      throw error;
    }
    return result;
  }
  byId('connectWallet').onclick = async () => {
    try {
      const provider = providers.get(byId('walletProvider').value);
      if (!provider) throw new Error('MetaMask or Rabby was not detected. You can still use a public address for read-only checks.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (await chainId(provider) !== 50383) throw new Error('Set the wallet to Somnia Hideki, chain ID 50383, then reconnect.');
      if (!accounts?.[0]) throw new Error('Wallet returned no account');
      byId('account').value = accounts[0];
      byId('walletState').textContent = accounts[0] + ' · Hideki 50383';
      invalidate('Wallet connected. Run a new LIVE preflight.');
      provider.on?.('accountsChanged', () => {
        invalidate('Wallet account changed. Reconnect and check again.');
        byId('walletState').textContent = 'Wallet account changed';
      });
      provider.on?.('chainChanged', () => {
        invalidate('Wallet network changed. Reconnect on Hideki.');
        byId('walletState').textContent = 'Wallet network changed';
      });
    } catch (error) {
      invalidate('Wallet connection failed.');
      byId('planOutput').textContent = error.message;
    }
  };

  byId('planForm').onsubmit = async event => {
    event.preventDefault();
    invalidate('Running fresh read-only preflight.');
    byId('planHash').value = '';
    byId('planDetail').hidden = true;
    const operation = byId('operation').value;
    const request = { operation, account: byId('account').value.trim(), pool: byId('pool').value,
      isBid: byId('side').value === 'buy', price: byId('price').value.trim(),
      quantity: byId('quantity').value.trim(), orderId: byId('orderId').value.trim() };
    if (operation === 'CANCEL') { delete request.price; delete request.quantity; }
    if (operation === 'CLOSE' && !request.quantity) delete request.quantity;
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(request.account) || !/^0x[0-9a-fA-F]{40}$/.test(request.pool))
        throw new Error('Enter a public EVM account and choose a market.');
      if (operation !== 'CANCEL' && (!/^\d{1,24}(?:\.\d{1,24})?$/.test(request.price) ||
          /^0+(?:\.0+)?$/.test(request.price) ||
          (request.quantity !== undefined && (!/^\d{1,24}(?:\.\d{1,24})?$/.test(request.quantity) ||
            /^0+(?:\.0+)?$/.test(request.quantity)))))
        throw new Error('Enter positive decimal price and quantity.');
      if (operation === 'CANCEL' && !/^\d{1,39}$/.test(request.orderId))
        throw new Error('Enter a decimal resting order ID.');
      byId('planOutput').textContent = 'Reading current Hideki market, wallet and margin state…';
      const record = await api('/api/v1/plan', request);
      const plan = record.payload;
      byId('planHash').value = record.hash;
      byId('planOutput').className = 'notice';
      byId('planOutput').textContent = record.state + ' · ' + plan.symbol + ' · block ' + plan.baseline.blockNumber +
        ' · ' + (plan.blockers.join('; ') || 'SDK preflight passed at observation time') +
        ' · whitelist ' + (plan.wallet?.whitelist || 'NOT VERIFIED') + ' · plan ' + record.hash;
      byId('planDetail').hidden = false;
      byId('planDetail').textContent = JSON.stringify({ request: plan.request, wallet: plan.wallet,
        preview: plan.preview, blockers: plan.blockers, warnings: plan.warnings,
        unsigned: plan.unsigned || 'NOT AVAILABLE' }, null, 2);
      byId('reviewWallet').hidden = true;
      byId('sendState').textContent = 'M2.6 execution lock: signing and broadcast require separate M3 approval.';
      await loadRecords();
    } catch (error) {
      byId('planOutput').className = 'notice error';
      byId('planOutput').textContent = (error.code === 'RPC_TIMEOUT' ? 'RPC_TIMEOUT · read-only preflight unavailable · ' : 'PREFLIGHT FAILED · ') + error.message;
      byId('sendState').textContent = 'No transaction requested. Correct the input or retry read-only preflight.';
    }
  };

  byId('reviewWallet').onclick = () => {
    invalidate('M2.6 execution lock: no wallet signature or transaction request. Separate M3 approval required.');
  };
})();
