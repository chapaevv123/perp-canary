import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { promptHidden } from '../src/local-prompt.ts';

function terminal() {
  let raw = false;
  const input = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode(value: boolean) { raw = value; },
  }) as unknown as ReadStream;
  const output = Object.assign(new PassThrough(), { isTTY: true }) as unknown as WriteStream;
  let shown = '';
  output.on('data', chunk => { shown += chunk.toString(); });
  return { input, output, shown: () => shown, raw: () => raw };
}

test('masked password accepts pasted text and Enter without printing plaintext', async () => {
  const io = terminal();
  const pending = promptHidden('Local bot keystore password: ', io.input, io.output);
  io.input.write('fixture-only-secret\r');
  assert.equal(await pending, 'fixture-only-secret');
  assert.equal(io.shown(), `Local bot keystore password: ${'*'.repeat(19)}\n`);
  assert.equal(io.raw(), false);
});

test('empty Enter retries, Backspace edits mask, and Windows paste markers stay hidden', async () => {
  const io = terminal();
  const pending = promptHidden('Password: ', io.input, io.output);
  io.input.write('\r\n');
  io.input.write('\u001b[200~abc\u001b[201~');
  io.input.write('\bD\r');
  assert.equal(await pending, 'abD');
  assert.match(io.shown(), /Password is empty/);
  assert.ok(!io.shown().includes('abc'));
  assert.equal(io.raw(), false);
});

test('literal Ctrl+V gives visible guidance and pasted bytes remain masked', async () => {
  const io = terminal();
  const pending = promptHidden('Password: ', io.input, io.output);
  io.input.write('\u0016');
  io.input.write('secret\r');
  assert.equal(await pending, 'secret');
  assert.match(io.shown(), /Ctrl\+V key received/);
  assert.ok(!io.shown().includes('secret'));
});

test('EOF and Ctrl+C cancel safely and restore terminal mode', async () => {
  const eof = terminal();
  const closed = promptHidden('Password: ', eof.input, eof.output);
  eof.input.end();
  await assert.rejects(closed, /Input closed/);
  assert.equal(eof.raw(), false);
  const interrupted = terminal();
  const cancelled = promptHidden('Password: ', interrupted.input, interrupted.output);
  interrupted.input.write('\u0003');
  await assert.rejects(cancelled, /Cancelled/);
  assert.equal(interrupted.raw(), false);
});
