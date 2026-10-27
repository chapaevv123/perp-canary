import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerializable,
  type TransactionSerializedLegacy } from 'viem';
import { BTC_POOL } from './trade-forensics.ts';

const same = (a: string | undefined | null, b: string | undefined | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export type SignedTransactionInspection = { passed: true } |
  { passed: false; stage: 'SIGNATURE_VERIFY' | 'NONCE' | 'GAS' | 'CALLDATA'; reason: string };
const rejected = (stage: Exclude<SignedTransactionInspection, { passed: true }>['stage'],
  reason: string): SignedTransactionInspection => ({ passed: false, stage, reason });
export function inspectSignedFields(actual: { chainId?: number; to?: string | null; data?: string;
  value?: bigint; gas?: bigint; gasPrice?: bigint; nonce?: number },
expected: TransactionSerializable, operator: string, recovered: string): SignedTransactionInspection {
  if (actual.chainId !== 50383 || expected.chainId !== 50383)
    return rejected('SIGNATURE_VERIFY', 'CHAIN_ID_MISMATCH');
  if (!same(recovered, operator)) return rejected('SIGNATURE_VERIFY', 'SENDER_MISMATCH');
  if (actual.nonce !== expected.nonce) return rejected('NONCE', 'SIGNED_NONCE_MISMATCH');
  if (actual.gas !== expected.gas || actual.gasPrice !== expected.gasPrice)
    return rejected('GAS', 'SIGNED_GAS_MISMATCH');
  if (!same(actual.to, BTC_POOL) || !same(actual.to, expected.to))
    return rejected('CALLDATA', 'SIGNED_TARGET_MISMATCH');
  // viem omits the zero value field when parsing a legacy transaction.
  if ((actual.value ?? 0n) !== 0n || expected.value !== 0n)
    return rejected('CALLDATA', 'SIGNED_VALUE_MISMATCH');
  if (actual.data !== expected.data) return rejected('CALLDATA', 'SIGNED_CALLDATA_MISMATCH');
  return { passed: true };
}
export function signedFieldsMatch(actual: { chainId?: number; to?: string | null; data?: string;
  value?: bigint; gas?: bigint; gasPrice?: bigint; nonce?: number },
expected: TransactionSerializable, operator: string, recovered: string): boolean {
  return inspectSignedFields(actual, expected, operator, recovered).passed;
}
export async function inspectSignedBotTransaction(raw: Hex, expected: TransactionSerializable,
  operator: string): Promise<SignedTransactionInspection> {
  try {
    const parsed = parseTransaction(raw);
    if (parsed.type !== 'legacy') return rejected('SIGNATURE_VERIFY', 'SIGNED_TYPE_MISMATCH');
    const recovered = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedLegacy });
    return inspectSignedFields(parsed, expected, operator, recovered);
  } catch { return rejected('SIGNATURE_VERIFY', 'SIGNED_DECODE_OR_RECOVERY_FAILED'); }
}
export async function verifySignedBotTransaction(raw: Hex, expected: TransactionSerializable,
operator: string): Promise<boolean> {
  return (await inspectSignedBotTransaction(raw, expected, operator)).passed;
}
