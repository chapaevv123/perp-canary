import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { confirmExecuteHash } from '../src/execute-confirmation.ts';

const HASH = 'a'.repeat(64);
function streams(tty = false) {
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  const output = Object.assign(new PassThrough(), { isTTY: tty });
  let transcript = '';
  output.on('data', chunk => { transcript += chunk.toString(); });
  return { input, output, transcript: () => transcript };
}

test('exact 64-character hash pasted with Windows CRLF confirms and echoes in TTY mode', async () => {
  const io = streams(true);
  const answer = confirmExecuteHash(HASH, new Date(Date.now() + 5_000).toISOString(), io.input, io.output);
  io.input.write(`EXECUTE ${HASH}\r\n`);
  assert.equal(await answer, 'CONFIRMED');
  assert.match(io.transcript(), new RegExp(`EXECUTE ${HASH}`));
  assert.match(io.transcript(), /Confirmation:/);
});

test('empty input and wrong or shortened hashes retry until exact standard input arrives', async () => {
  const io = streams();
  const answer = confirmExecuteHash(HASH, new Date(Date.now() + 5_000).toISOString(), io.input, io.output);
  io.input.write('\n');
  io.input.write('yes\n');
  io.input.write(`EXECUTE ${HASH.slice(0, -1)}\n`);
  io.input.write(`EXECUTE ${HASH}\n`);
  assert.equal(await answer, 'CONFIRMED');
  assert.match(io.transcript(), /Empty input/);
  assert.match(io.transcript(), /does not match the full plan hash/);
});

test('EOF safely cancels and timeout expires during owner confirmation', async () => {
  const eof = streams();
  const cancelled = confirmExecuteHash(HASH, new Date(Date.now() + 5_000).toISOString(), eof.input, eof.output);
  eof.input.end();
  assert.equal(await cancelled, 'CANCELLED');
  assert.match(eof.transcript(), /input closed/);
  const expired = streams();
  assert.equal(await confirmExecuteHash(HASH,
    new Date(Date.now() + 30).toISOString(), expired.input, expired.output), 'EXPIRED');
  assert.match(expired.transcript(), /expired/);
});
