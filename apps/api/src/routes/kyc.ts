import type { FastifyInstance } from 'fastify';
import { KycSubmissionSchema } from '@afristable/shared';
import { requireUser } from '../middleware/auth.js';

export async function registerKyc(app: FastifyInstance) {
  const { kyc, prisma } = app.container;

  app.post('/submit', { preHandler: requireUser }, async (req) => {
    const body = KycSubmissionSchema.parse(req.body);
    const rec = await kyc.submit(
      { userId: req.auth!.userId, ...body },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { kycRecordId: rec.id, status: rec.status, targetTier: rec.targetTier };
  });

  app.get('/status', { preHandler: requireUser }, async (req) => {
    const latest = await prisma.kycRecord.findFirst({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, targetTier: true, rejectionReason: true,
        riskScore: true, reviewedAt: true, createdAt: true,
      },
    });
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { kycTier: true },
    });
    return { currentTier: user?.kycTier ?? 'TIER_0', latest };
  });
}
