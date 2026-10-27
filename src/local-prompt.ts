import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ReadStream, WriteStream } from 'node:tty';

export async function promptText(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw Error('Interactive local terminal required');
  const input = createInterface({ input: stdin, output: stdout });
  try { return await input.question(label); }
  finally { input.close(); }
}
export async function promptHidden(label: string, input: ReadStream = stdin,
  output: WriteStream = stdout): Promise<string> {
  if (!input.isTTY || !input.setRawMode || !output.isTTY)
    throw Error('Interactive local terminal required for masked password input');
  output.write(label);
  let value = '';
  let escape = '';
  let lastWasCR = false;
  const decoder = new StringDecoder('utf8');
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        for (const char of decoder.write(chunk)) {
          if (char === '\n' && lastWasCR) { lastWasCR = false; continue; }
          lastWasCR = char === '\r';
          if (escape) {
            escape += char;
            if (escape.length > 16 || /[A-Za-z~]$/.test(escape)) escape = '';
            continue;
          }
          if (char === '\u001b') { escape = char; continue; }
          if (char === '\r' || char === '\n') {
            if (!value) { output.write('\nPassword is empty. Type or paste it again: '); continue; }
            cleanup(); output.write('\n'); resolve(value); return;
          }
          if (char === '\u0003') { cleanup(); output.write('\n'); reject(Error('Cancelled')); return; }
          if (char === '\u0016') {
            output.write('\nCtrl+V key received. If no stars appear, try right-click or the terminal paste shortcut.\nPassword: ');
            output.write('*'.repeat([...value].length));
            continue;
          }
          if (char === '\u007f' || char === '\b') {
            if (value) { value = [...value].slice(0, -1).join(''); output.write('\b \b'); }
            continue;
          }
          if (char.codePointAt(0)! >= 32) {
            if (Buffer.byteLength(value + char, 'utf8') > 1024) {
              cleanup(); output.write('\n'); reject(Error('Password input exceeds 1024 UTF-8 bytes')); return;
            }
            value += char; output.write('*');
          }
        }
      };
      const onEnd = () => { cleanup(); output.write('\n'); reject(Error('Input closed; password entry cancelled')); };
      const cleanup = () => { input.off('data', onData); input.off('end', onEnd); input.off('close', onEnd); };
      input.on('data', onData);
      input.on('end', onEnd);
      input.on('close', onEnd);
    });
  } finally { value = ''; input.setRawMode(false); input.pause(); }
}
