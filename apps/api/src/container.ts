/**
 * Composition root.
 *
 * One factory wires every service together. Anything that needs configuration
 * (DB, Redis, providers) is constructed here and never reached for via globals.
 */
import { prisma } from '@afristable/database';
import { env } from '@afristable/config';
import { LedgerService } from '@afristable/ledger';
import { FraudEngine } from '@afristable/fraud';
import {
  AuditLogger,
  KycService,
  LimitService,
  StubSanctionsProvider,
} from '@afristable/compliance';
import {
  DatabasePriceFeed,
  QuoteService,
  TransferService,
  WithdrawalService,
  PayoutRegistry,
  MpesaProvider,
  MtnMomoProvider,
  OrangeMoneyProvider,
  AirtelMoneyProvider,
  FlutterwaveProvider,
  PaystackProvider,
} from '@afristable/payments';
import {
  ChainRegistry, EvmProvider, SolanaProvider, StellarProvider,
} from '@afristable/blockchain';

export function buildContainer() {
  const e = env();

  // ---- core services ----
  const ledger    = new LedgerService(prisma);
  const audit     = new AuditLogger(prisma);
  const sanctions = new StubSanctionsProvider();
  const kyc       = new KycService(prisma, sanctions, audit);
  const limits    = new LimitService(prisma);
  const fraud     = new FraudEngine(prisma);
  const prices    = new DatabasePriceFeed(prisma);
  const quotes    = new QuoteService(prisma, prices);

  // ---- chain providers ----
  const chains = new ChainRegistry();
  chains.register(new EvmProvider('ETHEREUM', e.EVM_ETHEREUM_RPC_URL, {
    USDC: e.USDC_ETHEREUM, USDT: e.USDT_ETHEREUM,
  }));
  chains.register(new EvmProvider('POLYGON', e.EVM_POLYGON_RPC_URL, {
    USDC: e.USDC_POLYGON, USDT: e.USDT_POLYGON,
  }));
  chains.register(new EvmProvider('BASE', e.EVM_BASE_RPC_URL, {
    USDC: e.USDC_BASE,
  }));
  chains.register(new SolanaProvider(e.SOLANA_RPC_URL));
  chains.register(new StellarProvider(e.STELLAR_HORIZON_URL));

  // ---- payout rails ----
  const payouts = new PayoutRegistry();
  payouts.register(new MpesaProvider(
    e.MPESA_CONSUMER_KEY && e.MPESA_CONSUMER_SECRET && e.MPESA_BASE_URL ? {
      baseUrl: e.MPESA_BASE_URL,
      consumerKey: e.MPESA_CONSUMER_KEY,
      consumerSecret: e.MPESA_CONSUMER_SECRET,
      shortcode: '',
      webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));
  payouts.register(new MtnMomoProvider(
    e.MTN_MOMO_API_KEY && e.MTN_MOMO_SUBSCRIPTION_KEY && e.MTN_MOMO_BASE_URL ? {
      baseUrl: e.MTN_MOMO_BASE_URL,
      subscriptionKey: e.MTN_MOMO_SUBSCRIPTION_KEY,
      apiUserId: '',
      apiKey: e.MTN_MOMO_API_KEY,
      webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));
  payouts.register(new OrangeMoneyProvider(
    e.ORANGE_MONEY_CLIENT_ID && e.ORANGE_MONEY_CLIENT_SECRET && e.ORANGE_MONEY_BASE_URL ? {
      baseUrl: e.ORANGE_MONEY_BASE_URL,
      clientId: e.ORANGE_MONEY_CLIENT_ID,
      clientSecret: e.ORANGE_MONEY_CLIENT_SECRET,
      webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));
  payouts.register(new AirtelMoneyProvider(
    e.AIRTEL_MONEY_CLIENT_ID && e.AIRTEL_MONEY_CLIENT_SECRET && e.AIRTEL_MONEY_BASE_URL ? {
      baseUrl: e.AIRTEL_MONEY_BASE_URL,
      clientId: e.AIRTEL_MONEY_CLIENT_ID,
      clientSecret: e.AIRTEL_MONEY_CLIENT_SECRET,
      webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));
  payouts.register(new FlutterwaveProvider(
    e.FLUTTERWAVE_SECRET_KEY && e.FLUTTERWAVE_BASE_URL ? {
      baseUrl: e.FLUTTERWAVE_BASE_URL,
      secretKey: e.FLUTTERWAVE_SECRET_KEY,
      webhookSecret: e.FLUTTERWAVE_WEBHOOK_SECRET ?? e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));
  payouts.register(new PaystackProvider(
    e.PAYSTACK_SECRET_KEY && e.PAYSTACK_BASE_URL ? {
      baseUrl: e.PAYSTACK_BASE_URL,
      secretKey: e.PAYSTACK_SECRET_KEY,
      webhookSecret: e.PAYSTACK_WEBHOOK_SECRET ?? e.WEBHOOK_SIGNING_SECRET,
    } : null,
  ));

  const transfers   = new TransferService  (prisma, ledger, quotes, fraud, audit, limits, prices);
  const withdrawals = new WithdrawalService(prisma, ledger, quotes, fraud, audit, limits, prices, payouts);

  return {
    prisma, env: e,
    ledger, audit, kyc, limits, fraud, prices, quotes,
    chains, payouts, transfers, withdrawals,
  };
}

export type Container = ReturnType<typeof buildContainer>;
