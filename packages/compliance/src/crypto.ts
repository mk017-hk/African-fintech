/**
 * Column-level encryption for PII.
 *
 *   format: v1:<iv-base64>:<ciphertext-base64>:<authTag-base64>
 *
 * AES-256-GCM with a single key sourced from PII_ENCRYPTION_KEY.
 * In production, store the key in a KMS-backed secret and add key-rotation
 * by prefixing the version (e.g. v2:…) and dispatching on it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '@afristable/config';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = env().PII_ENCRYPTION_KEY;
  return Buffer.from(hex, 'hex');
}

export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptPii(blob: string): string {
  const [version, ivB64, ctB64, tagB64] = blob.split(':');
  if (version !== 'v1' || !ivB64 || !ctB64 || !tagB64) {
    throw new Error('Invalid encrypted PII blob');
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Searchable hash for fields that must be looked up but cannot be stored in
 * plaintext (e.g. phone number lookups). Use a peppered HMAC, not a raw hash.
 */
import { createHmac } from 'node:crypto';
export function lookupHash(value: string): string {
  return createHmac('sha256', getKey()).update(value.trim().toLowerCase()).digest('hex');
}
