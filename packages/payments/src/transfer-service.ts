/**
 * TransferService — internal P2P transfers between two AfriStable users.
 *
 * For now, P2P is single-currency only; cross-currency P2P is built on top
 * of the quote/FX engine and uses the WithdrawalService for off-platform
 * destinations.
 *
 * Money flow (sender X → receiver Y, currency C, fee F):
 *   1. assertWalletHasFunds(sender, amount + fee)
 *   2. Ledger posting:
 *       DEBIT  sender_wallet[C]          amount + fee
 *       CREDIT receiver_wallet[C]        amount
 *       CREDIT sys_fee[C]                fee
 *   3. Transaction row updated to COMPLETED.
 */
import { randomToken } from '@afristable/shared';
import {
  AppError,
  Money,
  Conflict,
  NotFound,
  WalletFrozen,
  KycRequired,
} from '@afristable/shared';
import type { PrismaClient } from '@afristable/database';
import { LedgerService, credit, debit } from '@afristable/ledger';
import { FraudEngine } from '@afristable/fraud';
import { AuditLogger, LimitService } from '@afristable/compliance';
import { QuoteService } from './quote-service';
import { PriceFeed } from './pricing/price-feed';

export interface InternalTransferInput {
  senderId: string;
  receiverId: string;
  quoteId: string;
  idempotencyKey: string;
  note?: string;
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export class TransferService {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly quotes: QuoteService,
    private readonly fraud: FraudEngine,
    private readonly audit: AuditLogger,
    private readonly limits: LimitService,
    private readonly prices: PriceFeed,
  ) {}

  async sendInternal(input: InternalTransferInput) {
    if (input.senderId === input.receiverId) {
      throw new AppError('VALIDATION_ERROR', 'Cannot send to self', 400);
    }

    // Idempotency replay short-circuit.
    const replay = await this.db.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
    if (replay) {
      const tx = await this.db.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (tx) return tx;
    }

    const sender = await this.db.user.findUnique({
      where: { id: input.senderId },
      select: { id: true, kycTier: true, status: true },
    });
    if (!sender) throw NotFound('Sender not found');
    if (sender.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account not active', 403);
    if (sender.kycTier === 'TIER_0') throw KycRequired('TIER_1');

    const receiver = await this.db.user.findUnique({
      where: { id: input.receiverId }, select: { id: true, status: true },
    });
    if (!receiver || receiver.status === 'CLOSED') throw NotFound('Receiver not found');
    if (receiver.status === 'SUSPENDED') throw new AppError('FORBIDDEN', 'Receiver suspended', 403);

    return await this.db.$transaction(async (tx) => {
      const quote = await this.quotes.consume(input.quoteId, input.senderId, tx);
      if (quote.fromCurrency !== quote.toCurrency) {
        throw new AppError('VALIDATION_ERROR', 'Internal P2P requires same currency on both sides', 400);
      }
      const currency = quote.fromCurrency;

      const walletType = ['USDC', 'USDT'].includes(currency) ? 'STABLECOIN' : 'FIAT';
      const senderWallet = await tx.wallet.findUnique({
        where: { userId_currency_type: { userId: input.senderId, currency, type: walletType } },
      });
      const receiverWallet = await this.ensureWallet(tx, input.receiverId, currency);

      if (!senderWallet) throw NotFound('Sender wallet not found');
      if (senderWallet.status !== 'ACTIVE') throw WalletFrozen();

      const fee = quote.feeAmountMoney;
      const net = quote.toAmountMoney;
      const total = net.add(fee);

      await this.ledger.assertWalletHasFunds(senderWallet.id, total, tx);

      const usdRate = await this.prices.getRate(currency, 'USD');
      const usdAmount = Number(net.toString()) * usdRate.toNumber();
      await this.limits.assertWithinLimits(input.senderId, sender.kycTier, usdAmount);

      const decision = await this.fraud.evaluate(
        { kind: 'transfer.initiate', amountUsd: usdAmount, destinationKind: 'user', destinationRef: receiver.id },
        { userId: input.senderId, ip: input.ip, userAgent: input.userAgent,
          deviceFingerprint: input.deviceFingerprint },
      );
      if (decision.action === 'BLOCK') {
        throw new AppError('RISK_REJECTED', 'Transfer blocked by risk policy', 403, { score: decision.score });
      }

      const transaction = await tx.transaction.create({
        data: {
          type: 'P2P_TRANSFER',
          status: decision.action === 'REVIEW' ? 'REQUIRES_APPROVAL' : 'PROCESSING',
          senderId: input.senderId,
          receiverId: input.receiverId,
          amount: net.toString(),
          currency,
          feeAmount: fee.toString(),
          feeCurrency: fee.currency,
          fxRate: '1',
          quoteId: quote.id,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            note: input.note,
            usdEquivalent: usdAmount.toFixed(6),
            riskScore: decision.score,
            riskAction: decision.action,
          },
        },
      });

      if (decision.action === 'REVIEW') {
        await tx.approvalQueueItem.create({
          data: {
            kind: 'transfer',
            subjectUserId: input.senderId,
            transactionId: transaction.id,
            payload: { reasons: decision.reasons } as object,
          },
        });
        // No money moves until approved. Funds are NOT locked here, but we
        // could optionally lock by debiting from `availableBalance` into a
        // suspense account; keep it simple.
        return transaction;
      }

      const feeAccount = await this.systemAccount(tx, 'SYSTEM_FEE', currency);

      await this.ledger.post({
        transferId: randomToken(16),
        transactionId: transaction.id,
        memo: 'p2p',
        legs: [
          debit (senderWallet.ledgerAccountId, total, 'p2p:send'),
          credit(receiverWallet.ledgerAccountId, net, 'p2p:recv'),
          credit(feeAccount.id, fee, 'p2p:fee'),
        ],
      }, tx);

      const finalised = await tx.transaction.update({
        where: { id: transaction.id }, data: { status: 'COMPLETED' },
      });

      // Idempotency cache (24h).
      await tx.idempotencyKey.create({
        data: {
          key: input.idempotencyKey,
          userId: input.senderId,
          endpoint: 'transfers.internal',
          requestHash: 'sha256:omitted', // filled by HTTP layer normally
          responseStatus: 200,
          responseBody: { transactionId: finalised.id } as object,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await this.audit.log({
        actorType: 'user', actorId: input.senderId, userId: input.senderId,
        action: 'transfer.internal.completed',
        resourceType: 'transaction', resourceId: finalised.id,
        ip: input.ip, userAgent: input.userAgent,
        metadata: { amount: net.toString(), currency, fee: fee.toString() },
      });

      return finalised;
    }, { isolationLevel: 'Serializable' });
  }

  private async ensureWallet(tx: import('@afristable/database').Tx, userId: string, currency: string) {
    const isStable = ['USDC', 'USDT'].includes(currency);
    const type = isStable ? 'STABLECOIN' : 'FIAT';
    const existing = await tx.wallet.findUnique({
      where: { userId_currency_type: { userId, currency, type } },
    });
    if (existing) return existing;
    const account = await tx.ledgerAccount.create({
      data: { kind: 'USER_WALLET', currency, normalSide: 'CREDIT' },
    });
    return tx.wallet.create({
      data: { userId, type, currency, ledgerAccountId: account.id },
    });
  }

  private async systemAccount(tx: import('@afristable/database').Tx, kind: string, currency: string) {
    const acct = await tx.ledgerAccount.findFirst({
      where: { kind: kind as never, currency },
    });
    if (!acct) throw new Error(`System account missing: ${kind}/${currency}`);
    return acct;
  }
}
