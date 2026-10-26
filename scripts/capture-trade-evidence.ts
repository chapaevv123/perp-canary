import { collectTradeForensics, OWNER_TRADING_WALLET, OWNER_TX } from '../src/trade-forensics.ts';
import { saveTradeArtifact } from '../src/trade-evidence.ts';

const txHash = process.argv[2] ?? OWNER_TX;
const tradingWallet = process.argv[3] ?? OWNER_TRADING_WALLET;
const artifact = await collectTradeForensics({ txHash, tradingWallet });
if (!artifact.transaction || !artifact.receipt || !artifact.block)
  throw Error('Transaction not found with a complete block and receipt; no evidence file saved');
const file = await saveTradeArtifact('trade-evidence', artifact);
console.log(JSON.stringify({ file, hash: artifact.hash, chainId: artifact.chainId,
  receiptStatus: artifact.receipt.status, confidence: artifact.evidenceConfidence,
  events: artifact.decodedEvents.map(event => event.eventName),
  reconciliation: artifact.positionReconciliation, walletAttribution: artifact.walletAttribution }, null, 2));
