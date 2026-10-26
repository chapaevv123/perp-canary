import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const limitMs = 240_000;
const child = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'snapshot'],
  { cwd: root, stdio: 'inherit' });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`Snapshot process remained active after ${limitMs} ms. Terminating it; check SDK cleanup and the last printed phase. Existing evidence files are retained.`);
  child.kill();
}, limitMs);

child.once('error', error => {
  clearTimeout(timer);
  console.error(`Could not start snapshot process: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) process.exitCode = 124;
  else if (signal) {
    console.error(`Snapshot process ended with signal ${signal}`);
    process.exitCode = 1;
  } else process.exitCode = code ?? 1;
});
