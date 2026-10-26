import { getAddress, isAddress } from 'viem';

export function canonicalBotAddress(value: string): string {
  if (value.length !== 42 || !/^0x[0-9a-fA-F]{40}$/.test(value) || !isAddress(value, { strict: false }))
    throw Error('Bot metadata does not contain a plain 42-character EVM address');
  return getAddress(value);
}

export function comparePublicAddresses(entered: string, metadata: string) {
  const exactLength = entered.length === 42;
  const plainHex = /^0x[0-9a-fA-F]{40}$/.test(entered);
  const canonical = canonicalBotAddress(metadata);
  const differences: { position: number; entered: string; expected: string; caseOnly: boolean }[] = [];
  for (let i = 0; i < Math.max(entered.length, canonical.length); i++) {
    if (entered[i] !== canonical[i]) differences.push({ position: i + 1, entered: entered[i] ?? '',
      expected: canonical[i] ?? '', caseOnly: entered[i]?.toLowerCase() === canonical[i]?.toLowerCase() });
  }
  return { exactLength, plainHex, viemStrict: isAddress(entered),
    viemNonStrict: isAddress(entered, { strict: false }), canonical,
    sameAddressIgnoringCase: entered.toLowerCase() === canonical.toLowerCase(), differences };
}
