/* Browser-only EIP-1193 wallet controller. No keys, background sends, or auto-retries. */
(() => {
  const byId = id => document.getElementById(id);
  const providers = new Map();
  let wallet = null;
  let active = null;
  let input = null;
  let requestOpen = false;

  function invalidate(message) {
    active = null;
    input = null;
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
    if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
    return result;
  }
  byId('connectWallet').onclick = async () => {
    try {
      const provider = providers.get(byId('walletProvider').value);
      if (!provider) throw new Error('MetaMask or Rabby was not detected. You can still use a public address for read-only checks.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (await chainId(provider) !== 50383) throw new Error('Set the wallet to Somnia Hideki, chain ID 50383, then reconnect.');
      if (!accounts?.[0]) throw new Error('Wallet returned no account');
      wallet = { provider, account: accounts[0] };
      byId('account').value = accounts[0];
      byId('walletState').textContent = accounts[0] + ' · Hideki 50383';
      invalidate('Wallet connected. Run a new LIVE preflight.');
      provider.on?.('accountsChanged', () => {
        wallet = null; invalidate('Wallet account changed. Reconnect and check again.');
        byId('walletState').textContent = 'Wallet account changed';
      });
      provider.on?.('chainChanged', () => {
        wallet = null; invalidate('Wallet network changed. Reconnect on Hideki.');
        byId('walletState').textContent = 'Wallet network changed';
      });
    } catch (error) {
      wallet = null; invalidate('Wallet connection failed.');
      byId('planOutput').textContent = error.message;
    }
  };

  byId('planForm').onsubmit = async event => {
    event.preventDefault();
    invalidate('Running fresh read-only preflight.');
    const operation = byId('operation').value;
    const request = { operation, account: byId('account').value.trim(), pool: byId('pool').value,
      isBid: byId('side').value === 'buy', price: byId('price').value.trim(),
      quantity: byId('quantity').value.trim(), orderId: byId('orderId').value.trim() };
    if (operation === 'CANCEL') { delete request.price; delete request.quantity; }
    if (operation === 'CLOSE' && !request.quantity) delete request.quantity;
    try {
      byId('planOutput').textContent = 'Reading current Hideki market, wallet and margin state…';
      const record = await api('/api/v1/plan', request);
      const plan = record.payload;
      active = record;
      input = request;
      byId('planHash').value = record.hash;
      byId('planOutput').className = 'notice';
      byId('planOutput').textContent = record.state + ' · ' + plan.symbol + ' · block ' + plan.baseline.blockNumber +
        ' · ' + (plan.blockers.join('; ') || 'SDK preflight passed at observation time') +
        ' · whitelist ' + (plan.wallet?.whitelist || 'NOT VERIFIED') + ' · plan ' + record.hash;
      byId('planDetail').hidden = false;
      byId('planDetail').textContent = JSON.stringify({ request: plan.request, wallet: plan.wallet,
        preview: plan.preview, blockers: plan.blockers, warnings: plan.warnings,
        unsigned: plan.unsigned || 'NOT AVAILABLE' }, null, 2);
      byId('reviewWallet').hidden = !(wallet && wallet.account.toLowerCase() === plan.account.toLowerCase() &&
        operation === 'PLACE' && plan.blockers.length === 0 && plan.unsigned);
      await loadRecords();
    } catch (error) {
      byId('planOutput').className = 'notice error';
      byId('planOutput').textContent = error.message;
    }
  };

  byId('reviewWallet').onclick = async () => {
    if (requestOpen) return;
    requestOpen = true;
    const button = byId('reviewWallet');
    button.disabled = true;
    try {
      const chosen = wallet;
      const first = active;
      const request = input;
      if (!chosen || !first || !request || request.operation !== 'PLACE') throw new Error('Connect a wallet and make a PLACE plan first');
      if (chosen.account.toLowerCase() !== request.account.toLowerCase()) throw new Error('Connected wallet differs from the plan account');
      if (await chainId(chosen.provider) !== 50383) throw new Error('Wallet is no longer on Hideki 50383');
      byId('sendState').textContent = 'Repeating LIVE preflight immediately before wallet review…';
      const fresh = await api('/api/v1/plan', request);
      const plan = fresh.payload;
      if (plan.blockers.length || !plan.unsigned) throw new Error('Fresh preflight blocked: ' + (plan.blockers.join('; ') || 'unsigned call unavailable'));
      if (plan.account.toLowerCase() !== chosen.account.toLowerCase() || plan.unsigned.chainId !== 50383 ||
          plan.unsigned.to.toLowerCase() !== plan.pool.toLowerCase() || plan.unsigned.value !== '0' ||
          plan.wallet?.gasLimit !== '10000000') {
        throw new Error('Unsigned order safety check failed');
      }
      byId('planHash').value = fresh.hash;
      const summary = 'SOMNIA HIDEKI TESTNET 50383 ONLY · IOC minimum order\n' + plan.symbol + ' ' +
        (request.isBid ? 'BUY ' : 'SELL ') + request.quantity + ' at limit ' + request.price +
        '\nPool: ' + plan.pool + '\nEstimated gas cost (wei): ' + plan.wallet.estimatedGasCostWei +
        '\nWhitelist: NOT VERIFIED\n\nContinue to your wallet? You must approve this transaction there separately.';
      if (!window.confirm(summary)) { byId('sendState').textContent = 'Cancelled before wallet request.'; return; }
      if (wallet !== chosen || await chainId(chosen.provider) !== 50383) throw new Error('Wallet account or network changed before submission');
      invalidate('Wallet request pending. Check wallet history before any retry.');
      const txHash = await chosen.provider.request({ method: 'eth_sendTransaction', params: [{
        from: chosen.account, to: plan.unsigned.to, data: plan.unsigned.data, value: '0x0',
        gas: '0x989680', chainId: '0xc4cf'
      }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Wallet returned no valid hash. Check wallet history before retrying');
      byId('planHash').value = fresh.hash;
      byId('txHash').value = txHash;
      byId('sendState').textContent = 'Wallet returned ' + txHash + '. Waiting for receipt; no automatic resend.';
      for (let i = 0; i < 18; i++) {
        try {
          const record = await api('/api/v1/reconcile', { planHash: fresh.hash, txHash });
          byId('reconcileOutput').textContent = record.payload.assessment.verdict + ' · ' +
            record.payload.assessment.reasons.join('; ') + ' · evidence ' + record.hash;
          showComparison(record.payload);
          await loadRecords();
          byId('sendState').textContent = 'Receipt verified: ' + txHash;
          return;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      byId('sendState').textContent = 'Receipt pending or read failed. Plan ' + fresh.hash +
        ', tx ' + txHash + '. Import the hash later in Order Lifecycle.';
    } catch (error) {
      byId('sendState').textContent = error.message + '. If a wallet request opened, check its history before retrying.';
    } finally {
      button.disabled = false;
      requestOpen = false;
    }
  };
})();
