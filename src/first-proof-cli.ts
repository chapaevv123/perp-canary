import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readBotKeystore } from './bot-keystore.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';
import { ownerBuyLimitReasons, priceReport } from './first-proof.ts';
import { buildPreparedPlan } from './delegated-plan.ts';
import { appendBotPlanEvidence } from './bot-evidence.ts';
import { loadExecutableBotPlan } from './bot-plan-loader.ts';
import { summarizePreflightBlockers } from './preflight-blocker-diagnostics.ts';

const runFile = promisify(execFile);
const mode = process.argv[2];
const interactive = mode === 'first-proof';
try {
  if (process.argv.length !== 3 || !['price', 'first-proof'].includes(mode ?? ''))
    throw Error('Use npm.cmd run canary-price or npm.cmd run canary-first-proof');
  const keystore = await readBotKeystore();
  if (!keystore) throw Error('Existing bot address metadata unavailable');
  const read = (price?: string, quantity?: string) => inspectTradingAuthorization({
    tradingWallet: OWNER_TRADING_WALLET, operator: keystore.address, pool: BTC_POOL,
    ...(price && quantity ? { side: 'BUY' as const, price, quantity,
      executionMode: 'POST_ONLY' as const } : {}) });
  const quote = priceReport(await read());
  console.log(JSON.stringify(quote, null, 2));
  if (!interactive) { if (quote.status !== 'READY') process.exitCode = 1; }
  else {
    if (quote.status !== 'READY') throw Error(`BLOCKED: ${quote.reasons.join('; ') || 'No admissible candidate; refresh market'}`);
    const choices = quote.candidates.filter(c => c.status === 'CANDIDATE');
    const prompt = createInterface({ input: stdin, output: stdout });
    let entered: string;
    try {
      entered = (await prompt.question('Select 1/2/3 candidate or enter your own BUY limit (Enter cancels): ')).trim();
    } finally { prompt.close(); }
    if (!entered) throw Error('CANCELLED: no price selected; no plan created');
    const selected = /^\d$/.test(entered) && Number(entered) >= 1 &&
      Number(entered) <= choices.length ? choices[Number(entered) - 1]!.price : entered;
    if (!/^\d{1,24}(?:\.\d{1,18})?$/.test(selected)) throw Error('Invalid owner-selected price');
    const quantity = quote.chosenQuantity;
    const input = { side: 'BUY' as const, price: selected, quantity,
      executionMode: 'POST_ONLY' as const };
    // This is a new independent read; the offered quote is not silently reused.
    const observation = await read(selected, quantity);
    const selectedReasons = ownerBuyLimitReasons(observation, selected, quantity);
    if (selectedReasons.length) {
      console.log(JSON.stringify({ status: 'BLOCKED', reasons: selectedReasons,
        transactionSent: 'NO', action: 'Refresh market and start a new owner-selected plan.' }, null, 2));
      process.exitCode = 1;
    } else {
      const plan = buildPreparedPlan(observation, input);
      if (plan.status !== 'PREPARED') {
        console.log(JSON.stringify({ status: 'BLOCKED', selectedPrice: selected, quantity,
          sampledBlock: observation.sampledBlock, observedAt: observation.observedAt,
          blockers: plan.blockers,
          preflight: summarizePreflightBlockers(observation, plan),
          marketIntegrity: observation.marketIntegrity, bestBidRaw: observation.bookTops.bestBidRaw,
          bestAskRaw: observation.bookTops.bestAskRaw, transactionSent: 'NO',
          action: 'Market or preflight changed. Start canary-first-proof again; no price is changed automatically.' }, null, 2));
        process.exitCode = 1;
      } else {
        const saved = await appendBotPlanEvidence('bot-evidence', plan);
        const loaded = await loadExecutableBotPlan('bot-evidence', plan.hash);
        if (loaded.hash !== plan.hash || loaded.status !== 'PREPARED')
          throw Error('Persisted plan did not round-trip through bot-execute loader');
        let checked: { status?: string; passed?: boolean; planHash?: string;
          blockers?: string[]; marketComparison?: unknown };
        try {
          const result = await runFile(process.execPath,
            ['--experimental-strip-types', 'src/execute-bot-cli.ts', 'check', plan.hash],
            { timeout: 90_000, maxBuffer: 1024 * 1024 });
          checked = JSON.parse(result.stdout) as typeof checked;
        } catch (error) {
          const detail = error as Error & { stdout?: string; stderr?: string };
          console.log(JSON.stringify({ status: 'BLOCKED', planHash: plan.hash,
            reason: (detail.stdout || detail.stderr || detail.message).trim().slice(0, 2000),
            transactionSent: 'NO', action: 'Inspect diagnostics; create a new plan after refreshing market.' }, null, 2));
          process.exitCode = 1;
          checked = { status: 'BLOCKED' };
        }
        if (checked.status === 'READY_FOR_OWNER_REVIEW' && checked.passed === true &&
          checked.planHash === loaded.hash && Date.now() < Date.parse(loaded.expiresAt)) {
          console.log(JSON.stringify({ status: 'READY_FOR_OWNER_REVIEW', planHash: loaded.hash,
            expiresAt: plan.expiresAt, side: plan.side, price: plan.price,
            quantity: plan.quantity, expectedPositionEffect: 'BUY can increase existing LONG if filled',
            orderNotionalWei: plan.risk.orderNotionalWei,
            estimatedGasUnits: plan.risk.estimatedGasUnits, gasLimit: plan.risk.gasLimit,
            maxGasCostWei: plan.risk.maxGasCostWei, recheck: checked.marketComparison,
            evidenceRecordHash: saved.hash, evidenceDirectory: 'bot-evidence',
            transactionSent: 'NO', ownerOnlyCommand: `npm.cmd run bot-execute -- execute ${loaded.hash}`,
            note: 'Separate owner decision required. The existing CLI repeats checks and asks for exact hash.' }, null, 2));
        } else if (process.exitCode !== 1) {
          console.log(JSON.stringify({ status: 'BLOCKED', planHash: plan.hash,
            blockers: checked.blockers ?? ['Read-only check did not confirm this saved plan or the plan expired'],
            transactionSent: 'NO', action: 'Refresh market and create a new plan; never reuse or reprice this plan.' }, null, 2));
          process.exitCode = 1;
        }
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'First proof read-only workflow failed');
  process.exitCode = 1;
}
