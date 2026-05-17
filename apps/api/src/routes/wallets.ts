import type { FastifyInstance } from 'fastify';
import { CreateWalletSchema, NotFound, isSupportedCurrency } from '@afristable/shared';
import { requireUser } from '../middleware/auth.js';

export async function registerWallets(app: FastifyInstance) {
  const { prisma, ledger } = app.container;

  app.get('/', { preHandler: requireUser }, async (req) => {
    const wallets = await prisma.wallet.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, type: true, currency: true, status: true,
        availableBalance: true, pendingBalance: true, lockedBalance: true,
      },
    });
    return { wallets: wallets.map((w) => ({
      ...w,
      availableBalance: w.availableBalance.toString(),
      pendingBalance:   w.pendingBalance.toString(),
      lockedBalance:    w.lockedBalance.toString(),
    })) };
  });

  app.post('/', { preHandler: requireUser }, async (req, reply) => {
    const body = CreateWalletSchema.parse(req.body);
    if (!isSupportedCurrency(body.currency)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unsupported currency' } });
    }
    const type = ['USDC', 'USDT'].includes(body.currency) ? 'STABLECOIN' : 'FIAT';
    const wallet = await prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findUnique({
        where: { userId_currency_type: { userId: req.auth!.userId, currency: body.currency, type } },
      });
      if (existing) return existing;
      const account = await tx.ledgerAccount.create({
        data: { kind: 'USER_WALLET', currency: body.currency, normalSide: 'CREDIT' },
      });
      return tx.wallet.create({
        data: {
          userId: req.auth!.userId,
          type, currency: body.currency,
          ledgerAccountId: account.id,
        },
      });
    });
    return reply.code(201).send({ id: wallet.id, currency: wallet.currency, type: wallet.type });
  });

  app.get('/:id', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const wallet = await prisma.wallet.findFirst({
      where: { id, userId: req.auth!.userId },
    });
    if (!wallet) throw NotFound('Wallet not found');
    const live = await ledger.getAccountBalance(wallet.ledgerAccountId);
    return {
      id: wallet.id,
      currency: wallet.currency,
      type: wallet.type,
      status: wallet.status,
      availableBalance: wallet.availableBalance.toString(),
      ledgerBalance: live.balance.toString(),
      pendingBalance: wallet.pendingBalance.toString(),
      lockedBalance: wallet.lockedBalance.toString(),
    };
  });

  app.get('/:id/transactions', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const wallet = await prisma.wallet.findFirst({ where: { id, userId: req.auth!.userId } });
    if (!wallet) throw NotFound('Wallet not found');
    const txs = await prisma.transaction.findMany({
      where: {
        OR: [
          { senderId: req.auth!.userId, currency: wallet.currency },
          { receiverId: req.auth!.userId, currency: wallet.currency },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { transactions: txs };
  });
}
