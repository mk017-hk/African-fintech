/**
 * JWT helpers. Access tokens are stateless and short-lived. Refresh tokens
 * are opaque random strings stored hashed in `sessions`.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@afristable/config';

export interface AccessClaims {
  sub: string;     // user id  (or admin id when role==='admin')
  sid: string;     // session id
  role?: 'user' | 'admin';
  perms?: string[];
  iat: number;
  exp: number;
}

function b64u(input: Buffer): string {
  return input.toString('base64url');
}
function b64uDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signHs256(payload: object, secret: string): string {
  const header = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = b64u(Buffer.from(JSON.stringify(payload)));
  const data   = `${header}.${body}`;
  const sig    = b64u(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyHs256<T>(token: string, secret: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { name: 'JsonWebTokenError' });
  const [h, b, s] = parts;
  const data = `${h}.${b}`;
  const expected = createHmac('sha256', secret).update(data).digest();
  const actual = b64uDecode(s!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Invalid signature'), { name: 'JsonWebTokenError' });
  }
  const payload = JSON.parse(b64uDecode(b!).toString('utf8'));
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw Object.assign(new Error('Token expired'), { name: 'TokenExpiredError' });
  }
  return payload as T;
}

export function issueAccessToken(opts: { sub: string; sid: string; role?: 'user' | 'admin'; perms?: string[] }): string {
  const e = env();
  const iat = Math.floor(Date.now() / 1000);
  return signHs256(
    { ...opts, iat, exp: iat + e.JWT_ACCESS_TTL_SECONDS },
    e.JWT_ACCESS_SECRET,
  );
}

export function verifyAccessToken(token: string): AccessClaims {
  return verifyHs256<AccessClaims>(token, env().JWT_ACCESS_SECRET);
}

/** Refresh tokens are opaque random strings; we store only the SHA-256. */
export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
