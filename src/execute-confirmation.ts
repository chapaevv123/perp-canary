import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';
import { remainingPlanSeconds } from './place-plan-config.ts';

type TerminalInput = Readable & { isTTY?: boolean };
type TerminalOutput = Writable & { isTTY?: boolean };
export type ConfirmationResult = 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export async function confirmExecuteHash(hash: string, expiresAt: string,
  input: TerminalInput = stdin, output: TerminalOutput = stdout): Promise<ConfirmationResult> {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw Error('Invalid plan hash for confirmation');
  const expected = `EXECUTE ${hash}`;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) { output.write('Plan expired before confirmation.\n'); return 'EXPIRED'; }
  const lineReader = createInterface({ input, output,
    terminal: Boolean(input.isTTY && output.isTTY), crlfDelay: Infinity });
  const timer = setTimeout(() => lineReader.close(), remaining);
  try {
    output.write(`Copy this exact line to confirm:\n${expected}\n`);
    output.write(`Time remaining: ${remainingPlanSeconds(expiresAt)} seconds\nConfirmation: `);
    for await (const line of lineReader) {
      if (Date.now() >= Date.parse(expiresAt)) {
        output.write('Plan expired while waiting for confirmation.\n');
        return 'EXPIRED';
      }
      if (line === expected) return 'CONFIRMED';
      output.write(line.length === 0 ? 'Empty input. Paste the complete confirmation line.\n' :
        'Confirmation does not match the full plan hash. Try again.\n');
      output.write(`Time remaining: ${remainingPlanSeconds(expiresAt)} seconds\nConfirmation: `);
    }
    if (Date.now() >= Date.parse(expiresAt)) {
      output.write('Plan expired while waiting for confirmation.\n');
      return 'EXPIRED';
    }
    output.write('Standard input closed; confirmation cancelled.\n');
    return 'CANCELLED';
  } finally { clearTimeout(timer); lineReader.close(); }
}
