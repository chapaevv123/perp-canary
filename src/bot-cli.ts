import { generatePrivateKey } from 'viem/accounts';
import { BOT_KEYSTORE_PATH, encryptBotKey, readBotKeystore, saveBotKeystore, unlockBotAddress } from './bot-keystore.ts';
import { canonicalBotAddress } from './bot-address.ts';
import { promptHidden } from './local-prompt.ts';

const command = process.argv[2];
try {
  if (process.argv.length !== 3) throw Error('Usage: npm run bot -- status|address|create|unlock');
  if (command === 'status') {
    const data = await readBotKeystore();
    console.log(JSON.stringify({ status: data ? 'LOCKED' : 'NOT_CONFIGURED', address: data?.address ?? null,
      chainId: 50383, path: BOT_KEYSTORE_PATH }));
  } else if (command === 'address') {
    const data = await readBotKeystore();
    if (!data) throw Error('Bot keystore is NOT_CONFIGURED');
    console.log(canonicalBotAddress(data.address));
  } else if (command === 'create') {
    if (await readBotKeystore()) throw Error('Bot keystore already exists; refusing replacement');
    const confirmation = await promptHidden('Type CREATE HIDEKI BOT to create a new local key: ');
    if (confirmation !== 'CREATE HIDEKI BOT') throw Error('Cancelled');
    const password = await promptHidden('New keystore password (minimum 16 characters): ');
    const repeat = await promptHidden('Repeat password: ');
    if (password !== repeat) throw Error('Passwords do not match');
    const data = await encryptBotKey(generatePrivateKey(), password);
    await saveBotKeystore(data);
    console.log(JSON.stringify({ status: 'LOCKED', address: data.address, chainId: 50383,
      instruction: 'Link only this public address in official dreamDEX after independent review.' }));
  } else if (command === 'unlock') {
    const data = await readBotKeystore();
    if (!data) throw Error('Bot keystore is NOT_CONFIGURED');
    const password = await promptHidden('Keystore password: ');
    console.log(JSON.stringify({ status: 'VALIDATED_AND_LOCKED', address: await unlockBotAddress(data, password),
      chainId: 50383, signing: 'DISABLED', broadcasting: 'DISABLED' }));
  } else throw Error('Usage: npm run bot -- status|address|create|unlock');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bot CLI failed');
  process.exitCode = 1;
}
