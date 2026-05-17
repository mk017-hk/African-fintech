import { randomBytes } from 'node:crypto';

/** Cryptographic random hex string of `bytes` length. */
export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric OTP, padded to `digits` length. Uses rejection sampling for unbiased distribution. */
export function randomOtp(digits = 6): string {
  const max = 10 ** digits;
  // 2^32 - (2^32 mod max) gives an unbiased rejection threshold.
  const threshold = 0x100000000 - (0x100000000 % max);
  while (true) {
    const candidate = randomBytes(4).readUInt32BE(0);
    if (candidate < threshold) {
      return (candidate % max).toString().padStart(digits, '0');
    }
  }
}
