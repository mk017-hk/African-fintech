/**
 * Admin routes — RBAC-protected.
 *
 * Login flow uses email + password + TOTP (recommended). Session is a
 * short-lived signed JWT in an httpOnly cookie + SameSite=Strict.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminLoginSchema, ApprovalDecisionSchema, KycReviewSchema,
  SuspendUserSchema, AuthInvalid, NotFound, randomToken, AppError,
} from '@afristable/shared';
import { env } from '@afristable/config';
import { verifyPassword } from '../auth/passwords.js';
import { issueAccessToken } from '../auth/tokens.js';
import { requireAdmin, requirePermission } from '../middleware/auth.js';
import { ledgerTotalsByCurrency, walletProjectionDrift, debit, credit } from '@afristable/ledger';

export async function registerAdmin(app: FastifyInstance) {
  const { prisma, audit, kyc, ledger } = app.container;
  const e = env();

  app.post('/login', async (req, reply) => {
    const body = AdminLoginSchema.parse(req.body);
    const admin = await prisma.adminUser.findUnique({
      where: { email: body.email },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!admin || !admin.isActive) throw AuthInvalid();
    const ok = await verifyPassword(body.password, admin.passwordHash);
    if (!ok) throw AuthInvalid();
    // TODO: verify TOTP if admin.totpSecretEnc; require it in production.

    const perms = new Set<string>();
    for (const r of admin.roles) for (const p of r.role.permissions) perms.add(p.permission.key);

    const token = issueAccessToken({
      sub: admin.id, sid: randomToken(8),
      role: 'admin', perms: [...perms],
    });
    reply.setCookie('admin_sid', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: e.NODE_ENV === 'production',
      path: '/v1/admin',
      maxAge: e.JWT_ACCESS_TTL_SECONDS,
    });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await audit.log({
      actorType: 'admin', actorId: admin.id,
      action: 'admin.login.success', ip: req.ip,
    });
    return { ok: true, permissions: [...perms] };
  });

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie('admin_sid', { path: '/v1/admin' });
    return { ok: true };
  });

  app.register(async (scope) => {
    scope.addHook('preHandler', requireAdmin);

    // ---- KYC queue ----
    scope.get('/kyc/queue', { preHandler: requirePermission('kyc.review') }, async (req) => {
      const q = z.object({
        status: z.enum(['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED']).default('IN_REVIEW'),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }).parse(req.query);
      const records = await prisma.kycRecord.findMany({
        where: { status: q.status }, take: q.limit, orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, email: true, countryCode: true } }, sanctionsHits: true, pepHits: true },
      });
      return { records };
    });

    scope.post('/kyc/review', { preHandler: requirePermission('kyc.review') }, async (req) => {
      const body = KycReviewSchema.parse(req.body);
      await kyc.review(body.kycRecordId, req.admin!.adminId, body.decision, {
        rejectionReason: body.rejectionReason,
        ip: req.ip, userAgent: req.headers['user-agent'],
      });
      return { ok: true };
    });

    // ---- Users ----
    scope.get('/users/:id', { preHandler: requirePermission('user.read') }, async (req) => {
      const { id } = req.params as { id: string };
      const user = await prisma.user.findUnique({
        where: { id },
        include: { profile: true, wallets: true, riskEvents: { take: 25, orderBy: { createdAt: 'desc' } } },
      });
      if (!user) throw NotFound('User not found');
      return user;
    });

    scope.post('/users/suspend', { preHandler: requirePermission('user.suspend') }, async (req) => {
      const body = SuspendUserSchema.parse(req.body);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: body.userId }, data: { status: 'SUSPENDED' } });
        await tx.wallet.updateMany({ where: { userId: body.userId }, data: { status: 'FROZEN' } });
      });
      await audit.log({
        actorType: 'admin', actorId: req.admin!.adminId, userId: body.userId,
        action: 'user.suspended', ip: req.ip,
        metadata: { reason: body.reason },
      });
      return { ok: true };
    });

    // ---- Approval queue ----
    scope.get('/approvals', { preHandler: requirePermission('withdrawal.approve') }, async (req) => {
      const q = z.object({
        kind: z.string().optional(),
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']).default('PENDING'),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }).parse(req.query);
      const items = await prisma.approvalQueueItem.findMany({
        where: { kind: q.kind, status: q.status },
        take: q.limit, orderBy: { createdAt: 'asc' },
        include: { subjectUser: { select: { id: true, email: true, kycTier: true } }, transaction: true },
      });
      return { items };
    });

    scope.post('/approvals/decide', { preHandler: requirePermission('withdrawal.approve') }, async (req) => {
      const body = ApprovalDecisionSchema.parse(req.body);
      const item = await prisma.approvalQueueItem.findUnique({
        where: { id: body.approvalId }, include: { transaction: true },
      });
      if (!item || item.status !== 'PENDING') throw NotFound('Approval not pending');

      await prisma.$transaction(async (tx) => {
        await tx.approvalQueueItem.update({
          where: { id: item.id },
          data: {
            status: body.decision,
            decidedBy: req.admin!.adminId,
            decidedAt: new Date(),
            decisionNote: body.note,
          },
        });

        // Move funds out of SUSPENSE according to the decision.
        if (item.kind === 'withdrawal' && item.transaction) {
          const txn = item.transaction;
          const senderWallet = await tx.wallet.findFirst({
            where: { userId: txn.senderId!, currency: txn.feeCurrency ?? txn.currency },
          });
          if (!senderWallet) throw NotFound('Sender wallet missing');
          const suspense = await tx.ledgerAccount.findFirst({
            where: { kind: 'SUSPENSE', currency: senderWallet.currency },
          });
          if (!suspense) throw new AppError('INTERNAL_ERROR', 'No suspense account', 500);

          const { Money } = await import('@afristable/shared');
          const fee = Money.of(txn.feeAmount.toString(), txn.feeCurrency ?? txn.currency);
          const net = Money.of(txn.amount.toString(),    txn.currency);
          const total = fee.add(net);

          if (body.decision === 'APPROVED') {
            const extRail = await tx.ledgerAccount.findFirst({ where: { kind: 'EXTERNAL_RAIL', currency: senderWallet.currency } });
            const feeAcct = await tx.ledgerAccount.findFirst({ where: { kind: 'SYSTEM_FEE', currency: senderWallet.currency } });
            if (!extRail || !feeAcct) throw new AppError('INTERNAL_ERROR', 'System accounts missing', 500);
            await ledger.post({
              transferId: randomToken(16),
              transactionId: txn.id,
              memo: 'withdraw:approve',
              legs: [
                debit (suspense.id, total, 'approve:release'),
                credit(extRail.id, net,    'approve:rail'),
                credit(feeAcct.id, fee,    'approve:fee'),
              ],
            }, tx);
            await tx.transaction.update({ where: { id: txn.id }, data: { status: 'PROCESSING' } });
            await tx.outboxMessage.create({
              data: {
                topic: `withdrawal.dispatch.${(txn.metadata as { rail?: string })?.rail}`,
                payload: { transactionId: txn.id } as object,
              },
            });
          } else {
            // REJECT — return funds to sender wallet.
            await ledger.post({
              transferId: randomToken(16),
              transactionId: txn.id,
              memo: 'withdraw:reject',
              legs: [
                debit (suspense.id,                 total, 'reject:release'),
                credit(senderWallet.ledgerAccountId, total, 'reject:refund'),
              ],
            }, tx);
            await tx.transaction.update({ where: { id: txn.id }, data: { status: 'CANCELLED' } });
          }
        }
      }, { isolationLevel: 'Serializable' });

      await audit.log({
        actorType: 'admin', actorId: req.admin!.adminId,
        userId: item.subjectUserId,
        action: `approval.${body.decision.toLowerCase()}`,
        resourceType: 'approval', resourceId: item.id,
        ip: req.ip, metadata: { kind: item.kind, note: body.note },
      });
      return { ok: true };
    });

    // ---- Fraud ----
    scope.get('/fraud/alerts', { preHandler: requirePermission('fraud.read') }, async (req) => {
      const q = z.object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE']).default('OPEN'),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }).parse(req.query);
      const alerts = await prisma.fraudAlert.findMany({
        where: { status: q.status }, take: q.limit, orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, kycTier: true } } },
      });
      return { alerts };
    });

    // ---- Ledger / treasury ----
    scope.get('/ledger/totals', { preHandler: requirePermission('ledger.read') }, async () => {
      return { totals: await ledgerTotalsByCurrency(prisma) };
    });

    scope.get('/ledger/drift', { preHandler: requirePermission('ledger.read') }, async () => {
      return { drift: await walletProjectionDrift(prisma) };
    });

    // ---- Audit ----
    scope.get('/audit', { preHandler: requirePermission('audit.read') }, async (req) => {
      const q = z.object({
        action: z.string().optional(),
        userId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(req.query);
      const logs = await prisma.auditLog.findMany({
        where: { action: q.action, userId: q.userId },
        orderBy: { createdAt: 'desc' }, take: q.limit,
      });
      return { logs };
    });
  });
}
