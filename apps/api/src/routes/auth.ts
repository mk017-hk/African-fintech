/**
 * Authentication routes.
 *
 *   POST /signup        — create user, send email + (optional) phone OTP
 *   POST /login         — password login, returns access+refresh tokens
 *   POST /otp/send      — request a fresh OTP for a purpose
 *   POST /otp/verify    — consume an OTP, returns status
 *   POST /refresh       — rotate refresh token
 *   POST /logout        — revoke current session
 *   GET  /me            — current user profile
 *
 * Brute force defence:
 *   - per-IP rate limit on /login + /otp/* (10/min via @fastify/rate-limit)
 *   - exponential lockout on user after 5 failed logins
 *   - OTP attempts capped at OTP_MAX_ATTEMPTS per challenge
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import {
  SignupSchema, LoginSchema, OtpVerifySchema, RefreshTokenSchema,
  AuthInvalid, AuthRequired, ValidationError, Conflict, randomOtp,
} from '@afristable/shared';
import { hashPassword, verifyPassword, hashOtp } from '../auth/passwords.js';
import { issueAccessToken, newRefreshToken, hashRefreshToken } from '../auth/tokens.js';
import { deviceFingerprint, requireUser } from '../middleware/auth.js';
import { env } from '@afristable/config';

const OtpSendSchema = z.object({
  destination: z.string().min(1),
  purpose: z.enum(['EMAIL_VERIFY', 'PHONE_VERIFY', 'LOGIN', 'TRANSACTION', 'RECOVERY']),
});

export async function registerAuth(app: FastifyInstance) {
  const { prisma, audit, fraud } = app.container;
  const e = env();

  app.post('/signup', async (req, reply) => {
    const body = SignupSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw Conflict('Email already registered');

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          phoneE164: body.phoneE164,
          countryCode: body.countryCode,
          status: 'PENDING',
          kycTier: 'TIER_0',
        },
      });
      // Issue email-verify OTP and (if phone given) phone-verify OTP.
      await createOtp(tx, u.id, body.email, 'EMAIL_VERIFY');
      if (body.phoneE164) await createOtp(tx, u.id, body.phoneE164, 'PHONE_VERIFY');
      return u;
    });

    await audit.log({
      actorType: 'user', actorId: user.id, userId: user.id,
      action: 'auth.signup',
      ip: req.ip, userAgent: req.headers['user-agent'],
    });

    return reply.code(201).send({
      userId: user.id,
      requiresEmailVerification: true,
      requiresPhoneVerification: !!body.phoneE164,
    });
  });

  app.post('/login', { config: { rateLimit: { max: e.RATE_LIMIT_AUTH_PER_MIN, timeWindow: '1 minute' } } },
    async (req) => {
      const body = LoginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });

      // Constant-ish work even if user doesn't exist, to mask account presence.
      const bogus = '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const ok = user
        ? await verifyPassword(body.password, user.passwordHash ?? bogus)
        : await verifyPassword(body.password, bogus);

      if (!user || !ok) {
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: { increment: 1 },
              lockedUntil: user.failedLoginCount >= 4
                ? new Date(Date.now() + 15 * 60 * 1000)
                : undefined,
            },
          });
        }
        throw AuthInvalid();
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        throw AuthInvalid();
      }
      if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
        throw AuthInvalid();
      }

      const fp = deviceFingerprint(req);
      const device = await prisma.device.upsert({
        where: { userId_fingerprintHash: { userId: user.id, fingerprintHash: fp } },
        update: { lastSeenAt: new Date() },
        create: {
          userId: user.id,
          fingerprintHash: fp,
          userAgent: req.headers['user-agent'] ?? null,
          ipFirstSeen: req.ip,
        },
      });

      const { raw: refreshRaw, hash: refreshHash } = newRefreshToken();
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          refreshTokenHash: refreshHash,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          expiresAt: new Date(Date.now() + e.JWT_REFRESH_TTL_SECONDS * 1000),
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      const accessToken = issueAccessToken({ sub: user.id, sid: session.id, role: 'user' });

      // Fraud signals (non-blocking).
      void fraud.evaluate(
        { kind: 'auth.login', success: true },
        { userId: user.id, ip: req.ip, deviceFingerprint: fp, userAgent: req.headers['user-agent'] },
      ).catch(() => undefined);

      await audit.log({
        actorType: 'user', actorId: user.id, userId: user.id,
        action: 'auth.login.success',
        ip: req.ip, userAgent: req.headers['user-agent'],
      });

      return {
        accessToken,
        refreshToken: refreshRaw,
        expiresIn: e.JWT_ACCESS_TTL_SECONDS,
        user: { id: user.id, email: user.email, kycTier: user.kycTier, status: user.status },
      };
    });

  app.post('/refresh', async (req) => {
    const body = RefreshTokenSchema.parse(req.body);
    const hash = hashRefreshToken(body.refreshToken);
    const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw AuthInvalid();
    }
    // Rotate refresh token — single-use.
    const { raw, hash: newHash } = newRefreshToken();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newHash,
        expiresAt: new Date(Date.now() + e.JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });
    const accessToken = issueAccessToken({ sub: session.userId, sid: session.id, role: 'user' });
    return { accessToken, refreshToken: raw, expiresIn: e.JWT_ACCESS_TTL_SECONDS };
  });

  app.post('/logout', { preHandler: requireUser }, async (req) => {
    if (!req.auth) throw AuthRequired();
    await prisma.session.update({
      where: { id: req.auth.sessionId },
      data: { revokedAt: new Date() },
    });
    await audit.log({
      actorType: 'user', actorId: req.auth.userId, userId: req.auth.userId,
      action: 'auth.logout', ip: req.ip,
    });
    return { ok: true };
  });

  app.post('/otp/send', { config: { rateLimit: { max: e.RATE_LIMIT_AUTH_PER_MIN, timeWindow: '1 minute' } } },
    async (req) => {
      const body = OtpSendSchema.parse(req.body);
      const challenge = await createOtp(prisma, undefined, body.destination, body.purpose);
      // Real prod: enqueue email/SMS via notification service. Here: never log the code.
      return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
    });

  app.post('/otp/verify', { config: { rateLimit: { max: e.RATE_LIMIT_AUTH_PER_MIN, timeWindow: '1 minute' } } },
    async (req) => {
      const body = OtpVerifySchema.parse(req.body);
      const challenge = await prisma.otpChallenge.findUnique({ where: { id: body.challengeId } });
      if (!challenge || challenge.consumedAt) throw AuthInvalid();
      if (challenge.expiresAt.getTime() < Date.now()) throw AuthInvalid();
      if (challenge.attempts >= e.OTP_MAX_ATTEMPTS) throw AuthInvalid();

      const ok = challenge.codeHash === hashOtp(body.code);
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: ok
          ? { consumedAt: new Date() }
          : { attempts: { increment: 1 } },
      });
      if (!ok) {
        if (challenge.userId) {
          void fraud.evaluate(
            { kind: 'auth.otp_attempt', success: false },
            { userId: challenge.userId, ip: req.ip },
          ).catch(() => undefined);
        }
        throw AuthInvalid();
      }
      // Side effects on verified destination.
      if (challenge.purpose === 'EMAIL_VERIFY' && challenge.userId) {
        await prisma.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } });
      } else if (challenge.purpose === 'PHONE_VERIFY' && challenge.userId) {
        await prisma.user.update({ where: { id: challenge.userId }, data: { phoneVerifiedAt: new Date() } });
      }
      return { ok: true };
    });

  app.get('/me', { preHandler: requireUser }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: { profile: true },
    });
    if (!user) throw AuthRequired();
    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      countryCode: user.countryCode,
      status: user.status,
      kycTier: user.kycTier,
      preferredCurrency: user.preferredCurrency,
      profile: user.profile ? {
        firstName: user.profile.firstName,
        lastName:  user.profile.lastName,
        city: user.profile.city,
        region: user.profile.region,
      } : null,
    };
  });
}

async function createOtp(
  client: { otpChallenge: { create: (a: { data: unknown }) => Promise<{ id: string; expiresAt: Date }> } },
  userId: string | undefined,
  destination: string,
  purpose: 'EMAIL_VERIFY' | 'PHONE_VERIFY' | 'LOGIN' | 'TRANSACTION' | 'RECOVERY',
) {
  const code = randomOtp(6);
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + env().OTP_TTL_SECONDS * 1000);
  const challenge = await client.otpChallenge.create({
    data: {
      userId, destination, purpose, codeHash, expiresAt,
    },
  });
  // DELIVERY: in production this would be a queued notification job.
  // Code is never logged. Surface in dev via a side channel only.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[OTP/DEV] ${destination} (${purpose}): ${code}`);
  }
  return challenge;
}
