/**
 * Dev-only seed. Creates pre-activated test users with funded wallets so you
 * can sign in immediately without going through OTP verification.
 *
 * SAFETY: refuses to run when NODE_ENV === 'production'. The user accounts
 * here have well-known passwords; they must never reach a live environment.
 *
 *   pnpm db:seed:dev
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient, type KycTier } from '@prisma/client';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run dev seed in production');
  process.exit(1);
}

let argon2: typeof import('argon2') | null = null;
async function loadArgon2() {
  if (argon2) return argon2;
  try { argon2 = await import('argon2'); } catch { argon2 = null; }
  return argon2;
}

async function hashPassword(plain: string): Promise<string> {
  const a = await loadArgon2();
  if (a) {
    return a.hash(plain, { type: a.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

interface DevUser {
  email: string;
  password: string;
  phoneE164: string;
  countryCode: string;
  kycTier: KycTier;
  firstName: string;
  lastName: string;
  funding: Array<{ currency: string; amount: string }>;
}

const USERS: DevUser[] = [
  {
    email: 'alice@demo.test',
    password: 'AlicePass_999!',
    phoneE164: '+254700000001',
    countryCode: 'KE',
    kycTier: 'TIER_2',
    firstName: 'Alice', lastName: 'Otieno',
    funding: [
      { currency: 'USDC', amount: '5000' },
      { currency: 'KES',  amount: '50000' },
    ],
  },
  {
    email: 'bob@demo.test',
    password: 'BobPass_999!',
    phoneE164: '+2348000000002',
    countryCode: 'NG',
    kycTier: 'TIER_2',
    firstName: 'Bob', lastName: 'Okafor',
    funding: [
      { currency: 'USDC', amount: '1000' },
      { currency: 'NGN',  amount: '500000' },
    ],
  },
  {
    email: 'charlie@demo.test',
    password: 'CharliePass_999!',
    phoneE164: '+233200000003',
    countryCode: 'GH',
    kycTier: 'TIER_3',
    firstName: 'Charlie', lastName: 'Mensah',
    funding: [
      { currency: 'USDC', amount: '10000' },
      { currency: 'USDT', amount: '2500' },
      { currency: 'GHS',  amount: '25000' },
    ],
  },
];

async function ensureWallet(userId: string, currency: string) {
  const isStable = ['USDC', 'USDT'].includes(currency);
  const type = isStable ? 'STABLECOIN' : 'FIAT';
  const existing = await prisma.wallet.findUnique({
    where: { userId_currency_type: { userId, currency, type } },
  });
  if (existing) return existing;
  const account = await prisma.ledgerAccount.create({
    data: { kind: 'USER_WALLET', currency, normalSide: 'CREDIT' },
  });
  return prisma.wallet.create({
    data: { userId, type, currency, ledgerAccountId: account.id },
  });
}

async function fundWallet(walletId: string, ledgerAccountId: string, currency: string, amount: string) {
  // Find the matching SYS_LIQUIDITY account (asset side of the deposit).
  const liq = await prisma.ledgerAccount.findFirst({
    where: { kind: 'SYSTEM_LIQUIDITY', currency },
  });
  if (!liq) {
    console.warn(`  ⚠ no SYS_LIQUIDITY account for ${currency} — skipping funding`);
    return;
  }
  const transferId = `devseed-${walletId}-${currency}`;
  // Idempotent: skip if we already posted this funding.
  const already = await prisma.ledgerEntry.findFirst({ where: { transferId } });
  if (already) return;

  await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: { transferId, accountId: ledgerAccountId, amount, side: 'CREDIT', currency, memo: 'devseed:fund' },
    }),
    prisma.ledgerEntry.create({
      data: { transferId, accountId: liq.id,         amount, side: 'DEBIT',  currency, memo: 'devseed:fund' },
    }),
    prisma.wallet.update({
      where: { id: walletId },
      data: { availableBalance: amount },
    }),
  ]);
}

async function main() {
  console.log('▶ Dev seed — creating test users with funded wallets…\n');

  for (const u of USERS) {
    const passwordHash = await hashPassword(u.password);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        status: 'ACTIVE',
        kycTier: u.kycTier,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        email: u.email,
        passwordHash,
        phoneE164: u.phoneE164,
        countryCode: u.countryCode,
        status: 'ACTIVE',
        kycTier: u.kycTier,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        profile: {
          create: { firstName: u.firstName, lastName: u.lastName },
        },
      },
    });

    for (const f of u.funding) {
      const wallet = await ensureWallet(user.id, f.currency);
      await fundWallet(wallet.id, wallet.ledgerAccountId, f.currency, f.amount);
    }

    console.log(`  ✔ ${u.email}  (tier ${u.kycTier})  — wallets: ${u.funding.map(f => `${f.amount} ${f.currency}`).join(', ')}`);
  }

  console.log('\n──────────────────────────────────────────');
  console.log(' Dev test logins (NEVER use in production)');
  console.log('──────────────────────────────────────────');
  for (const u of USERS) {
    console.log(` ${u.email.padEnd(22)}  ${u.password}`);
  }
  console.log('──────────────────────────────────────────\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
