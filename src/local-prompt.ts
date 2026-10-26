import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

export async function promptText(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw Error('Interactive local terminal required');
  const input = createInterface({ input: stdin, output: stdout });
  try { return await input.question(label); }
  finally { input.close(); }
}
export async function promptHidden(label: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode || !stdout.isTTY) throw Error('Interactive local terminal required');
  stdout.write(label);
  let value = '';
  stdin.setRawMode(true);
  stdin.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
          if (char === '\u0003') { cleanup(); stdout.write('\n'); reject(Error('Cancelled')); return; }
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else if (char.charCodeAt(0) >= 32 && Buffer.byteLength(value, 'utf8') < 1024) value += char;
        }
      };
      const cleanup = () => stdin.off('data', onData);
      stdin.on('data', onData);
    });
  } finally { stdin.setRawMode(false); stdin.pause(); }
}
