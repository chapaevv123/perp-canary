import { stdin, stdout } from 'node:process';
import { generatePrivateKey } from 'viem/accounts';
import { BOT_KEYSTORE_PATH, encryptBotKey, readBotKeystore, saveBotKeystore, unlockBotAddress } from './bot-keystore.ts';

async function hiddenPrompt(label: string): Promise<string> {
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

const command = process.argv[2];
try {
  if (process.argv.length !== 3) throw Error('Usage: npm run bot -- status|create|unlock');
  if (command === 'status') {
    const data = await readBotKeystore();
    console.log(JSON.stringify({ status: data ? 'LOCKED' : 'NOT_CONFIGURED', address: data?.address ?? null,
      chainId: 50383, path: BOT_KEYSTORE_PATH }));
  } else if (command === 'create') {
    if (await readBotKeystore()) throw Error('Bot keystore already exists; refusing replacement');
    const confirmation = await hiddenPrompt('Type CREATE HIDEKI BOT to create a new local key: ');
    if (confirmation !== 'CREATE HIDEKI BOT') throw Error('Cancelled');
    const password = await hiddenPrompt('New keystore password (minimum 16 characters): ');
    const repeat = await hiddenPrompt('Repeat password: ');
    if (password !== repeat) throw Error('Passwords do not match');
    const data = await encryptBotKey(generatePrivateKey(), password);
    await saveBotKeystore(data);
    console.log(JSON.stringify({ status: 'LOCKED', address: data.address, chainId: 50383,
      instruction: 'Link only this public address in official dreamDEX after independent review.' }));
  } else if (command === 'unlock') {
    const data = await readBotKeystore();
    if (!data) throw Error('Bot keystore is NOT_CONFIGURED');
    const password = await hiddenPrompt('Keystore password: ');
    console.log(JSON.stringify({ status: 'VALIDATED_AND_LOCKED', address: await unlockBotAddress(data, password),
      chainId: 50383, signing: 'DISABLED', broadcasting: 'DISABLED' }));
  } else throw Error('Usage: npm run bot -- status|create|unlock');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bot CLI failed');
  process.exitCode = 1;
}
