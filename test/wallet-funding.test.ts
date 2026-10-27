import assert from 'node:assert/strict';
import test from 'node:test';
import { HIDEKI_VOUCHER, voucherClaimBlocker, type readWalletFunding } from '../src/wallet-funding.ts';

type Funding = Awaited<ReturnType<typeof readWalletFunding>>;
const ready = { chainId: 50383, accountType: 'EOA', campaign: { distributor: HIDEKI_VOUCHER },
  eligibility: { eligible: true, grantUsdso: '1000' }, nativeSttWei: '1000000000000000000',
  btcVoucherAllowed: true } as Funding;

test('voucher gate distinguishes eligible, no-gas, ineligible and wrong-chain states', () => {
  assert.equal(voucherClaimBlocker(ready), null);
  assert.match(voucherClaimBlocker({ ...ready, nativeSttWei: '0' }) ?? '', /No Hideki STT/);
  assert.match(voucherClaimBlocker({ ...ready,
    eligibility: { eligible: false, reason: 'alreadyClaimed' } }) ?? '', /alreadyClaimed/);
  assert.match(voucherClaimBlocker({ ...ready, chainId: 50312 }) ?? '', /Hideki 50383/);
  assert.match(voucherClaimBlocker({ ...ready, btcVoucherAllowed: false }) ?? '', /BTC-PERP/);
});
