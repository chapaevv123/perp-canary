import { parseUnits } from 'viem';

/** An absent value means no custom order-notional limit. */
export function customNotionalLimit(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw Error('Custom maximum must be a positive USDso amount');
  const raw = parseUnits(value, 18);
  if (raw <= 0n) throw Error('Custom maximum must be a positive USDso amount');
  return raw;
}
