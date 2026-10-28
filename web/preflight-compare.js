// A new block or gas estimate may change; the user's order and transaction identity may not.
export function comparePreflight(reviewed, currentInput, fresh, now = Date.now()) {
  const issues = [], changes = [];
  const fail = (field, reason) => issues.push({ field, material: true, reason });
  const oldInput = reviewed.input, oldTx = reviewed.result.transaction, tx = fresh?.transaction;
  for (const field of ['mode', 'account', 'owner', 'market', 'side', 'orderType', 'price', 'quantity', 'customMaxNotional']) {
    const before = oldInput[field] ?? null, after = currentInput[field] ?? null;
    if (before !== after) fail(field, `${field} changed from ${before} to ${after}; review again.`);
  }
  const observation = fresh?.observation ?? null, account = fresh?.account ?? null;
  if (fresh?.status !== 'READY' || !tx) {
    const blockers = fresh?.guard?.blockers ?? [];
    for (const reason of blockers) fail(/PostOnly|book|market|mark/i.test(reason) ? 'book' :
      /grant|permission/i.test(reason) ? 'permission' : /margin|collateral|size/i.test(reason) ? 'margin' :
      /gas/i.test(reason) ? 'gas' : /simulation/i.test(reason) ? 'simulation' : 'preflight', reason);
    if (!blockers.length) fail('simulation', 'Fresh contract simulation did not produce a ready transaction. Review again.');
  }
  if (!oldTx) fail('review', 'Original review has no transaction. Review again.');
  if (tx && oldTx) {
    const freshCost = Number(tx.maxGasCostStt);
    if (!/^0x[0-9a-f]+$/i.test(tx.gas) || BigInt(tx.gas) <= 0n ||
      !Number.isFinite(freshCost) || freshCost < 0 || freshCost > 0.1)
      fail('gas', 'Fresh gas estimate is invalid or exceeds the 0.1 STT safety cap; review again.');
    if (tx.estimatedGas && BigInt(tx.gas) < BigInt(tx.estimatedGas))
      fail('gas', 'Fresh gas limit is below simulated gas usage; review again.');
    if (tx.chainId !== oldTx.chainId || tx.chainId !== 50383) fail('chainId', 'Network changed; switch to Somnia Hideki 50383 and review again.');
    if (tx.from.toLowerCase() !== oldTx.from.toLowerCase() ||
      tx.from.toLowerCase() !== oldInput.account.toLowerCase()) fail('operator', 'Transaction signer changed; review again.');
    if (tx.to.toLowerCase() !== oldTx.to.toLowerCase()) fail('pool', 'Pool target changed; review again.');
    if ((tx.owner ?? null)?.toLowerCase() !== (oldTx.owner ?? null)?.toLowerCase() ||
      (oldInput.mode === 'DELEGATED_PERPS' && tx.owner?.toLowerCase() !== oldInput.owner?.toLowerCase()))
      fail('owner', 'Delegated margin owner changed; review again.');
    if (tx.data.toLowerCase() !== oldTx.data.toLowerCase()) fail('calldata', 'Order calldata changed; review again.');
    if (tx.value !== oldTx.value || tx.value !== '0x0') fail('value', 'Transaction value changed; review again.');
    if (tx.nonce !== oldTx.nonce) fail('nonce', `Pending nonce changed from ${oldTx.nonce} to ${tx.nonce}; review again.`);
    if (tx.expiresAt !== oldTx.expiresAt || !Number.isFinite(Date.parse(tx.expiresAt)) ||
      Date.parse(tx.expiresAt) < now + 30_000)
      fail('expiry', 'Review expired or expiry changed; review again.');
    if (tx.gas !== oldTx.gas) changes.push({ field: 'gas', material: false,
      reason: `Fresh simulated gas limit changed from ${oldTx.gas} to ${tx.gas}; fresh safety cap was rechecked.` });
  }
  if (fresh?.guard?.blockers?.length) for (const reason of fresh.guard.blockers)
    if (!issues.some(issue => issue.reason === reason)) fail('guard', reason);
  if (fresh?.guard?.verdict === 'RED' || fresh?.guard?.verdict === 'UNKNOWN')
    fail('guard', `Fresh Trade Guard verdict is ${fresh.guard.verdict}; review again.`);
  if (oldInput.mode === 'DELEGATED_PERPS' && account?.permissions?.place !== true)
    fail('permission', 'Delegated place grant is not active in the fresh pool read; review after restoring permission.');
  if (fresh?.marginPreview && fresh.marginPreview.sufficient !== true)
    fail('margin', 'Fresh owner margin preview is insufficient; reduce size or add Wallet 1 margin.');
  if (observation?.block && reviewed.result.observation?.block &&
    observation.block !== reviewed.result.observation.block)
    changes.push({ field: 'block', material: false,
      reason: `Market block advanced from ${reviewed.result.observation.block} to ${observation.block}.` });
  return { ok: issues.length === 0, issues, changes,
    context: { bid: observation?.book?.bid ?? null, ask: observation?.book?.ask ?? null,
      limitPrice: oldInput.price, marginUsdso: account?.marginUnlocked ?? null,
      placeGrant: account?.permissions?.place ?? null,
      simulation: tx && fresh?.status === 'READY' ? 'PASSED' : 'BLOCKED',
      gasEstimateStt: tx?.maxGasCostStt ?? null } };
}

export function compareDelegatedCancel(reviewed, currentInput, fresh) {
  const issues = [];
  const fail = (field, reason) => issues.push({ field, reason });
  const before = reviewed.input, oldTx = reviewed.result.transaction, tx = fresh?.transaction;
  for (const field of ['mode', 'account', 'owner', 'market', 'action', 'orderId'])
    if ((before[field] ?? null) !== (currentInput[field] ?? null))
      fail(field, `${field} changed; review cancellation again.`);
  if (before.mode !== 'DELEGATED_PERPS' || before.action !== 'CANCEL')
    fail('mode', 'Only a delegated cancellation can use this review.');
  if (fresh?.status !== 'READY' || !tx) fail('simulation', 'Fresh cancellation simulation is not ready.');
  if (fresh?.owner?.toLowerCase() !== before.owner?.toLowerCase() ||
    fresh?.account?.owner?.toLowerCase() !== before.owner?.toLowerCase())
    fail('owner', 'Wallet 1 margin owner changed or was not verified.');
  if (fresh?.orderId !== before.orderId) fail('orderId', 'Cancellation order ID changed.');
  if (fresh?.account?.permissions?.cancel !== true) fail('permission', 'Fresh cancelOrderFor grant is inactive.');
  if (!fresh?.account?.openOrders?.some(order => order.id === before.orderId))
    fail('openOrder', 'Order is no longer open on the fresh Wallet 1 read.');
  if (tx && oldTx) {
    if (tx.chainId !== 50383 || tx.chainId !== oldTx.chainId) fail('chainId', 'Network changed.');
    if (tx.from?.toLowerCase() !== oldTx.from?.toLowerCase() ||
      tx.from?.toLowerCase() !== before.account?.toLowerCase()) fail('operator', 'Operator changed.');
    if (tx.to?.toLowerCase() !== oldTx.to?.toLowerCase()) fail('pool', 'Pool changed.');
    if (tx.data?.toLowerCase() !== oldTx.data?.toLowerCase()) fail('calldata', 'Cancellation calldata changed.');
    if (tx.value !== '0x0' || tx.value !== oldTx.value) fail('value', 'Transaction value changed.');
    if (tx.nonce !== oldTx.nonce) fail('nonce', 'Pending nonce changed.');
    const cost = Number(tx.maxGasCostStt);
    if (!/^0x[0-9a-f]+$/i.test(tx.gas ?? '') || !Number.isFinite(cost) || cost < 0 || cost > 0.1)
      fail('gas', 'Fresh gas estimate is invalid or exceeds the 0.1 STT safety cap.');
  }
  return { ok: issues.length === 0, issues, gasChanged: !!tx && !!oldTx && tx.gas !== oldTx.gas };
}
