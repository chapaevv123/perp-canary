import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';
import type { TransactionSerializable } from 'viem';

function deriveKey(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 32,
    { N: n, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key as Buffer)));
}
const SCHEMA = 'perp-canary/bot-keystore/v1';
const MIN_N = 1 << 14;
const DEFAULT_N = 1 << 17;
export const BOT_KEYSTORE_PATH = join(homedir(), '.perp-canary', 'bot-hideki.keystore');
export type BotKeystore = { schema: typeof SCHEMA; chainId: 50383; address: string;
  crypto: { cipher: 'aes-256-gcm'; kdf: 'scrypt'; n: number; r: 8; p: 1;
    salt: string; iv: string; ciphertext: string; tag: string } };

export class BotKeystoreError extends Error {
  constructor(message: string) { super(message); this.name = 'BotKeystoreError'; }
}
function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'i').test(value);
}
export function validateKeystore(value: unknown): BotKeystore {
  if (!value || typeof value !== 'object') throw new BotKeystoreError('Invalid bot keystore');
  const data = value as Partial<BotKeystore>;
  const crypto = data.crypto;
  if (data.schema !== SCHEMA || data.chainId !== 50383 ||
    typeof data.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(data.address) ||
    !crypto || crypto.cipher !== 'aes-256-gcm' || crypto.kdf !== 'scrypt' ||
    !Number.isInteger(crypto.n) || crypto.n! < MIN_N || crypto.n! > DEFAULT_N ||
    (crypto.n! & (crypto.n! - 1)) !== 0 || crypto.r !== 8 || crypto.p !== 1 ||
    !isHex(crypto.salt, 32) || !isHex(crypto.iv, 12) ||
    !isHex(crypto.ciphertext, 32) || !isHex(crypto.tag, 16))
    throw new BotKeystoreError('Invalid bot keystore');
  return data as BotKeystore;
}
export async function encryptBotKey(privateKey: Hex, password: string, n = DEFAULT_N): Promise<BotKeystore> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new BotKeystoreError('Invalid private key');
  if (password.length < 16 || Buffer.byteLength(password, 'utf8') > 1024)
    throw new BotKeystoreError('Password must contain 16–1024 UTF-8 bytes');
  if (!Number.isInteger(n) || n < MIN_N || n > DEFAULT_N || (n & (n - 1)) !== 0)
    throw new BotKeystoreError('Invalid scrypt work factor');
  const address = privateKeyToAccount(privateKey).address;
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, n);
  const plaintext = Buffer.from(privateKey.slice(2), 'hex');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${SCHEMA}|50383|${address.toLowerCase()}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result: BotKeystore = { schema: SCHEMA, chainId: 50383, address,
      crypto: { cipher: 'aes-256-gcm', kdf: 'scrypt', n, r: 8, p: 1,
        salt: salt.toString('hex'), iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex'),
        tag: cipher.getAuthTag().toString('hex') } };
    return validateKeystore(result);
  } finally { key.fill(0); plaintext.fill(0); }
}
export async function unlockBotAddress(value: unknown, password: string): Promise<string> {
  const data = validateKeystore(value);
  const c = data.crypto;
  const key = await deriveKey(password, Buffer.from(c.salt, 'hex'), c.n);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'hex'));
    decipher.setAAD(Buffer.from(`${SCHEMA}|50383|${data.address.toLowerCase()}`));
    decipher.setAuthTag(Buffer.from(c.tag, 'hex'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(c.ciphertext, 'hex')), decipher.final()]);
    const address = privateKeyToAccount(`0x${plaintext.toString('hex')}`).address;
    if (address !== getAddress(data.address)) throw new BotKeystoreError('Keystore address mismatch');
    return address;
  } catch { throw new BotKeystoreError('Password incorrect or keystore corrupted'); }
  finally { key.fill(0); plaintext?.fill(0); }
}
export type LocalBotSigner = { address: string;
  signTransaction: (transaction: TransactionSerializable) => Promise<Hex> };
export async function withUnlockedBotSigner<T>(value: unknown, password: string,
  action: (signer: LocalBotSigner) => Promise<T>): Promise<T> {
  const data = validateKeystore(value);
  const c = data.crypto;
  const key = await deriveKey(password, Buffer.from(c.salt, 'hex'), c.n);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'hex'));
    decipher.setAAD(Buffer.from(`${SCHEMA}|50383|${data.address.toLowerCase()}`));
    decipher.setAuthTag(Buffer.from(c.tag, 'hex'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(c.ciphertext, 'hex')), decipher.final()]);
    const account = privateKeyToAccount(`0x${plaintext.toString('hex')}`);
    if (account.address !== getAddress(data.address)) throw new BotKeystoreError('Keystore signer address mismatch');
    return await action({ address: account.address, signTransaction: tx => account.signTransaction(tx) });
  } catch (error) {
    if (error instanceof BotKeystoreError) throw error;
    throw new BotKeystoreError('Password incorrect, keystore corrupted, or local signing failed');
  } finally { key.fill(0); plaintext?.fill(0); }
}
export async function readBotKeystore(path = BOT_KEYSTORE_PATH): Promise<BotKeystore | null> {
  let contents: string;
  try { contents = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new BotKeystoreError('Bot keystore unreadable');
  }
  try { return validateKeystore(JSON.parse(contents)); }
  catch { throw new BotKeystoreError('Bot keystore corrupted'); }
}
export async function saveBotKeystore(data: BotKeystore, path = BOT_KEYSTORE_PATH): Promise<void> {
  validateKeystore(data);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(data)}\n`, { flag: 'wx', mode: 0o600 });
}
