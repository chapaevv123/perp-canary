import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerializable,
  type TransactionSerializedLegacy } from 'viem';
import { BTC_POOL } from './trade-forensics.ts';

const same = (a: string | undefined | null, b: string | undefined | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export function signedFieldsMatch(actual: { chainId?: number; to?: string | null; data?: string;
  value?: bigint; gas?: bigint; gasPrice?: bigint; nonce?: number },
expected: TransactionSerializable, operator: string, recovered: string): boolean {
  return actual.chainId === 50383 && expected.chainId === 50383 &&
    same(actual.to, BTC_POOL) && same(actual.to, expected.to) &&
    same(recovered, operator) && actual.data === expected.data &&
    actual.value === 0n && expected.value === 0n && actual.gas === expected.gas &&
    actual.gasPrice === expected.gasPrice && actual.nonce === expected.nonce;
}
export async function verifySignedBotTransaction(raw: Hex, expected: TransactionSerializable,
operator: string): Promise<boolean> {
  try {
    const parsed = parseTransaction(raw);
    const recovered = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedLegacy });
    return signedFieldsMatch(parsed, expected, operator, recovered);
  } catch { return false; }
}
