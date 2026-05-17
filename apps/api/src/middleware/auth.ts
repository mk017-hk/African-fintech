/**
 * Auth middleware.
 *
 * `requireUser`  — verifies Bearer access token, attaches `req.auth`.
 * `requireAdmin` — verifies admin session cookie, attaches `req.admin` with
 *                  the union of all permissions across the admin's roles.
 *
 * Access tokens are short-lived (15 min) and stateless. Refresh tokens are
 * opaque, stored hashed in `sessions`, and rotated on every refresh.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AuthRequired, AuthInvalid, AuthExpired, Forbidden } from '@afristable/shared';
import { verifyAccessToken } from '../auth/tokens.js';

export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AuthRequired();
  const token = header.slice('Bearer '.length);
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if ((err as Error).name === 'TokenExpiredError') throw AuthExpired();
    throw AuthInvalid();
  }
  req.auth = { userId: claims.sub, sessionId: claims.sid };
}

export function requirePermission(permission: string) {
  return async (req: FastifyRequest) => {
    if (!req.admin) throw AuthRequired();
    if (!req.admin.permissions.has(permission)) throw Forbidden(`Missing permission: ${permission}`);
  };
}

export async function requireAdmin(req: FastifyRequest) {
  const sid = req.cookies['admin_sid'];
  if (!sid) throw AuthRequired();
  // Cookie value: signed JWT containing {sub, perms[]}
  const claims = verifyAccessToken(sid);
  if (claims.role !== 'admin') throw AuthInvalid();
  req.admin = {
    adminId: claims.sub,
    permissions: new Set(claims.perms ?? []),
  };
}

/** SHA-256 of (ip + user-agent + accept-language). Stable for same device. */
export function deviceFingerprint(req: FastifyRequest): string {
  const ua = req.headers['user-agent'] ?? '';
  const al = req.headers['accept-language'] ?? '';
  return createHash('sha256').update(`${req.ip}|${ua}|${al}`).digest('hex');
}
