export function priceScenario(input, percent) {
  if (!input || !Number.isInteger(percent) || percent < -30 || percent > 30)
    throw Error('Choose a whole percent between -30 and +30.');
  const size = BigInt(input.sizeRaw), entry = BigInt(input.entryRaw), mark = BigInt(input.markRaw);
  const scale = 10n ** BigInt(input.baseDecimals);
  const target = mark * BigInt(100 + percent) / 100n;
  const pnl = size * (target - entry) / scale;
  const decimal = (raw, digits) => {
    const negative = raw < 0n, positive = negative ? -raw : raw, factor = 10n ** BigInt(digits);
    const fraction = (positive % factor).toString().padStart(digits, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${positive / factor}${fraction ? `.${fraction}` : ''}`;
  };
  return { targetPrice: decimal(target, 18), estimatedPnlUsdso: decimal(pnl, 18),
    source: 'PRICE_ONLY_SCENARIO', excludes: 'future funding, fees, liquidation and position changes' };
}
