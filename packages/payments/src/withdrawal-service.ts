/**
 * WithdrawalService — external value movement out of the platform.
 *
 * Pipeline:
 *   1. Validate destination + rail.
 *   2. Consume quote (lock funds).
 *   3. Run fraud engine → ALLOW / REVIEW / BLOCK.
 *   4. If amount > AUTO_APPROVE threshold OR risk REVIEW → enqueue approval.
 *   5. On approval, ledger DEBITs user wallet and CREDITs EXTERNAL_RAIL.
 *   6. Worker submits to the rail; webhook reconciles status.
 *   7. On terminal failure, ledger REVERSAL posting.
 *
 * Direct, uncontrolled withdrawals are explicitly forbidden by the system
 * design — every off-platform movement passes through this service.
 */
import {
  AppError, Money, KycRequired, NotFound, WalletFrozen, randomToken,
} from '@afristable/shared';
import { env } from '@afristable/config';
import type { PrismaClient } from '@afristable/database';
import { LedgerService, debit, credit } from '@afristable/ledger';
import { FraudEngine } from '@afristable/fraud';
import { AuditLogger, LimitService } from '@afristable/compliance';
import { QuoteService } from './quote-service';
import { PriceFeed } from './pricing/price-feed';
import { PayoutRegistry } from './rails/registry';

export interface OnchainWithdrawalInput {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
  network: 'ETHEREUM' | 'POLYGON' | 'BASE' | 'SOLANA' | 'STELLAR';
  toAddress: string;
  memo?: string;
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export interface MobileMoneyWithdrawalInput {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
  provider: 'MPESA' | 'MTN' | 'ORANGE' | 'AIRTEL';
  msisdnE164: string;
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export interface BankWithdrawalInput {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
  partner: 'flutterwave' | 'paystack' | 'generic';
  bankCode: string;
  accountNumber: string;
  accountName: string;
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export class WithdrawalService {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly quotes: QuoteService,
    private readonly fraud: FraudEngine,
    private readonly audit: AuditLogger,
    private readonly limits: LimitService,
    private readonly prices: PriceFeed,
    private readonly payouts: PayoutRegistry,
  ) {}

  // ---------------------------------------------------------------------- ON-CHAIN
  async withdrawOnchain(input: OnchainWithdrawalInput) {
    return await this.executeWithdrawal({
      ...input,
      rail: `onchain:${input.network.toLowerCase()}` as const,
      type: 'WITHDRAWAL_ONCHAIN',
      destinationRef: input.toAddress,
      createRailRecord: async (tx, transactionId, quote) => {
        await tx.stablecoinWithdrawal.create({
          data: {
            transactionId,
            network: input.network,
            asset: quote.toCurrency,
            toAddress: input.toAddress,
            amount: quote.toAmount.toString(),
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------------- MOBILE MONEY
  async withdrawMobileMoney(input: MobileMoneyWithdrawalInput) {
    const rail = `mobile_money:${input.provider.toLowerCase()}` as const;
    return await this.executeWithdrawal({
      ...input,
      rail,
      type: 'WITHDRAWAL_MOBILE_MONEY',
      destinationRef: input.msisdnE164,
      createRailRecord: async (tx, transactionId, quote) => {
        await tx.mobileMoneyPayout.create({
          data: {
            transactionId,
            provider: input.provider,
            msisdnE164: input.msisdnE164,
            amount: quote.toAmount.toString(),
            currency: quote.toCurrency,
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------------- BANK
  async withdrawBank(input: BankWithdrawalInput) {
    const rail = `bank:${input.partner}` as const;
    return await this.executeWithdrawal({
      ...input,
      rail,
      type: 'WITHDRAWAL_BANK',
      destinationRef: `${input.bankCode}:${input.accountNumber}`,
      createRailRecord: async (tx, transactionId, quote) => {
        const { encryptPii } = await import('@afristable/compliance');
        await tx.bankPayout.create({
          data: {
            transactionId,
            partner: input.partner,
            bankCode: input.bankCode,
            destinationEnc: encryptPii(JSON.stringify({
              accountNumber: input.accountNumber, accountName: input.accountName,
            })),
            amount: quote.toAmount.toString(),
            currency: quote.toCurrency,
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------------- shared core
  private async executeWithdrawal(args: {
    userId: string;
    quoteId: string;
    idempotencyKey: string;
    rail: string;
    type: 'WITHDRAWAL_ONCHAIN' | 'WITHDRAWAL_BANK' | 'WITHDRAWAL_MOBILE_MONEY';
    destinationRef: string;
    ip?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    createRailRecord: (tx: import('@afristable/database').Tx, transactionId: string, quote: { toAmount: Money; toCurrency: string }) => Promise<void>;
  }) {
    // Idempotency replay.
    const cached = await this.db.transaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (cached) return cached;

    const user = await this.db.user.findUnique({
      where: { id: args.userId },
      select: { id: true, status: true, kycTier: true },
    });
    if (!user) throw NotFound('User not found');
    if (user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account not active', 403);
    if (user.kycTier === 'TIER_0' || user.kycTier === 'TIER_1') {
      throw KycRequired('TIER_2');
    }

    return await this.db.$transaction(async (tx) => {
      const quote = await this.quotes.consume(args.quoteId, args.userId, tx);

      // Source wallet is the wallet in the quote's `fromCurrency`.
      const senderWallet = await this.findWallet(tx, args.userId, quote.fromCurrency);
      if (!senderWallet) throw NotFound('Source wallet not found');
      if (senderWallet.status !== 'ACTIVE') throw WalletFrozen();

      const usdRate = await this.prices.getRate(quote.fromCurrency, 'USD');
      const totalFrom = quote.fromAmountMoney; // includes fee
      const usdAmount = Number(totalFrom.toString()) * usdRate.toNumber();

      await this.limits.assertWithinLimits(args.userId, user.kycTier, usdAmount);
      await this.ledger.assertWalletHasFunds(senderWallet.id, totalFrom, tx);

      const fraudDecision = await this.fraud.evaluate(
        { kind: 'withdrawal.initiate', amountUsd: usdAmount, rail: args.rail, destinationRef: args.destinationRef },
        { userId: args.userId, ip: args.ip, userAgent: args.userAgent, deviceFingerprint: args.deviceFingerprint },
      );
      if (fraudDecision.action === 'BLOCK') {
        throw new AppError('RISK_REJECTED', 'Withdrawal blocked by risk policy', 403, { score: fraudDecision.score });
      }

      const e = env();
      const needsApproval =
        fraudDecision.action === 'REVIEW' ||
        usdAmount >= e.WITHDRAWAL_AUTO_APPROVE_USD;
      const status = needsApproval ? 'REQUIRES_APPROVAL' : 'PROCESSING';

      const transaction = await tx.transaction.create({
        data: {
          type: args.type,
          status,
          senderId: args.userId,
          amount: quote.toAmount.toString(),
          currency: quote.toCurrency,
          feeAmount: quote.feeAmount.toString(),
          feeCurrency: quote.feeCurrency,
          fxRate: quote.rate.toString(),
          quoteId: quote.id,
          idempotencyKey: args.idempotencyKey,
          metadata: {
            rail: args.rail,
            destinationRef: args.destinationRef,
            usdEquivalent: usdAmount.toFixed(6),
            riskScore: fraudDecision.score,
            riskAction: fraudDecision.action,
          },
        },
      });

      await args.createRailRecord(tx, transaction.id, {
        toAmount: quote.toAmountMoney, toCurrency: quote.toCurrency,
      });

      if (needsApproval) {
        await tx.approvalQueueItem.create({
          data: {
            kind: 'withdrawal',
            subjectUserId: args.userId,
            transactionId: transaction.id,
            payload: {
              rail: args.rail,
              destinationRef: args.destinationRef,
              amount: quote.fromAmount.toString(),
              currency: quote.fromCurrency,
              usdAmount,
              riskScore: fraudDecision.score,
              reasons: fraudDecision.reasons,
            } as object,
          },
        });

        // Reserve funds by debiting from wallet into a SUSPENSE account. On
        // approval, suspense → external rail; on rejection, suspense → wallet.
        const suspense = await this.systemAccount(tx, 'SUSPENSE', quote.fromCurrency);
        await this.ledger.post({
          transferId: randomToken(16),
          transactionId: transaction.id,
          memo: 'withdrawal:reserve',
          legs: [
            debit(senderWallet.ledgerAccountId, totalFrom, 'withdraw:reserve'),
            credit(suspense.id, totalFrom, 'withdraw:reserve'),
          ],
        }, tx);

        await this.audit.log({
          actorType: 'user', actorId: args.userId, userId: args.userId,
          action: 'withdrawal.queued',
          resourceType: 'transaction', resourceId: transaction.id,
          ip: args.ip, userAgent: args.userAgent,
          metadata: { rail: args.rail, usdAmount, riskScore: fraudDecision.score },
        });
        return transaction;
      }

      // Auto-approve path: post directly to external rail.
      const fee = quote.feeAmountMoney;
      const extRail = await this.systemAccount(tx, 'EXTERNAL_RAIL', quote.fromCurrency);
      const feeAcct = await this.systemAccount(tx, 'SYSTEM_FEE', quote.fromCurrency);
      await this.ledger.post({
        transferId: randomToken(16),
        transactionId: transaction.id,
        memo: 'withdrawal:send',
        legs: [
          debit(senderWallet.ledgerAccountId, totalFrom, 'withdraw:send'),
          credit(extRail.id, quote.fromAmountMoney.sub(fee), 'withdraw:rail'),
          credit(feeAcct.id, fee, 'withdraw:fee'),
        ],
      }, tx);

      await this.audit.log({
        actorType: 'user', actorId: args.userId, userId: args.userId,
        action: 'withdrawal.submitted',
        resourceType: 'transaction', resourceId: transaction.id,
        ip: args.ip, userAgent: args.userAgent,
        metadata: { rail: args.rail, usdAmount },
      });
      // The actual rail submission is performed by a worker that consumes
      // the outbox / queue. Here we publish an outbox row.
      await tx.outboxMessage.create({
        data: {
          topic: `withdrawal.dispatch.${args.rail}`,
          payload: { transactionId: transaction.id } as object,
        },
      });

      return transaction;
    }, { isolationLevel: 'Serializable' });
  }

  private async findWallet(tx: import('@afristable/database').Tx, userId: string, currency: string) {
    const isStable = ['USDC', 'USDT'].includes(currency);
    return tx.wallet.findUnique({
      where: { userId_currency_type: { userId, currency, type: isStable ? 'STABLECOIN' : 'FIAT' } },
    });
  }

  private async systemAccount(tx: import('@afristable/database').Tx, kind: string, currency: string) {
    const acct = await tx.ledgerAccount.findFirst({ where: { kind: kind as never, currency } });
    if (!acct) throw new Error(`System account missing: ${kind}/${currency}`);
    return acct;
  }
}
