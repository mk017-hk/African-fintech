/**
 * Password + OTP hashing.
 *
 * Passwords: argon2id with conservative parameters. The `argon2` package is
 * a native dep — falls back to a scrypt implementation when unavailable
 * (e.g. running scripts before `npm install` in some CI contexts).
 */
import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

type Argon2Module = typeof import('argon2');
let argon2: Argon2Module | null = null;
let argon2Loaded = false;
async function getArgon2(): Promise<Argon2Module | null> {
  if (argon2Loaded) return argon2;
  argon2Loaded = true;
  try { argon2 = (await import('argon2')) as Argon2Module; }
  catch { argon2 = null; }
  return argon2;
}

const SCRYPT_PREFIX = 'scrypt$';
const ARGON2_PREFIX = '$argon2id$';

export async function hashPassword(plain: string): Promise<string> {
  const a = await getArgon2();
  if (a) {
    return a.hash(plain, {
      type: a.argon2id,
      memoryCost: 19_456, // ~19 MiB
      timeCost: 2,
      parallelism: 1,
    });
  }
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith(ARGON2_PREFIX)) {
    const a = await getArgon2();
    if (!a) return false; // we have an argon hash but no argon lib — fail closed
    try { return await a.verify(stored, plain); }
    catch { return false; }
  }
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(plain, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  return false;
}

/** SHA-256 hex hash. Used to store OTP codes — single-use, short-lived. */
export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
