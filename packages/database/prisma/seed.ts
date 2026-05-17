/**
 * Seed script.
 *
 * Bootstraps:
 *   - System ledger accounts (revenue, fee suspense, FX spread, liquidity, gas)
 *   - RBAC roles + permissions
 *   - A root admin user (password printed once, never reused in prod)
 *   - Reference exchange rates
 *
 * Idempotent: re-running will not duplicate rows.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient, LedgerAccountKind, NormalSide } from '@prisma/client';

const prisma = new PrismaClient();

// Argon2id would be preferred in production. Using scrypt here to avoid native
// deps in the seed script — the application uses argon2id for real users.
function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const SYSTEM_ACCOUNTS: Array<{
  code: string;
  kind: LedgerAccountKind;
  currency: string;
  normalSide: NormalSide;
}> = [
  // USD-denominated rails
  { code: 'SYS_REVENUE_USD',   kind: 'SYSTEM_REVENUE',   currency: 'USD',  normalSide: 'CREDIT' },
  { code: 'SYS_FEE_USD',       kind: 'SYSTEM_FEE',       currency: 'USD',  normalSide: 'CREDIT' },
  { code: 'SYS_FX_SPREAD_USD', kind: 'SYSTEM_FX_SPREAD', currency: 'USD',  normalSide: 'CREDIT' },
  { code: 'SYS_LIQ_USD',       kind: 'SYSTEM_LIQUIDITY', currency: 'USD',  normalSide: 'DEBIT'  },
  { code: 'SYS_GAS_USD',       kind: 'SYSTEM_GAS',       currency: 'USD',  normalSide: 'DEBIT'  },
  // Stablecoins
  { code: 'SYS_LIQ_USDC',      kind: 'SYSTEM_LIQUIDITY', currency: 'USDC', normalSide: 'DEBIT'  },
  { code: 'SYS_LIQ_USDT',      kind: 'SYSTEM_LIQUIDITY', currency: 'USDT', normalSide: 'DEBIT'  },
  { code: 'SYS_FEE_USDC',      kind: 'SYSTEM_FEE',       currency: 'USDC', normalSide: 'CREDIT' },
  { code: 'SYS_FEE_USDT',      kind: 'SYSTEM_FEE',       currency: 'USDT', normalSide: 'CREDIT' },
  { code: 'EXT_RAIL_USDC',     kind: 'EXTERNAL_RAIL',    currency: 'USDC', normalSide: 'DEBIT'  },
  { code: 'EXT_RAIL_USDT',     kind: 'EXTERNAL_RAIL',    currency: 'USDT', normalSide: 'DEBIT'  },
  // African fiat
  { code: 'SYS_LIQ_NGN',       kind: 'SYSTEM_LIQUIDITY', currency: 'NGN',  normalSide: 'DEBIT'  },
  { code: 'SYS_LIQ_KES',       kind: 'SYSTEM_LIQUIDITY', currency: 'KES',  normalSide: 'DEBIT'  },
  { code: 'SYS_LIQ_GHS',       kind: 'SYSTEM_LIQUIDITY', currency: 'GHS',  normalSide: 'DEBIT'  },
  { code: 'SYS_LIQ_ZAR',       kind: 'SYSTEM_LIQUIDITY', currency: 'ZAR',  normalSide: 'DEBIT'  },
  { code: 'EXT_MPESA_KES',     kind: 'EXTERNAL_RAIL',    currency: 'KES',  normalSide: 'DEBIT'  },
  { code: 'EXT_MTN_GHS',       kind: 'EXTERNAL_RAIL',    currency: 'GHS',  normalSide: 'DEBIT'  },
  { code: 'EXT_FLW_NGN',       kind: 'EXTERNAL_RAIL',    currency: 'NGN',  normalSide: 'DEBIT'  },
  { code: 'EXT_PAYSTACK_NGN',  kind: 'EXTERNAL_RAIL',    currency: 'NGN',  normalSide: 'DEBIT'  },
];

const PERMISSIONS = [
  'user.read',
  'user.suspend',
  'kyc.read',
  'kyc.review',
  'kyc.approve',
  'kyc.reject',
  'wallet.read',
  'transaction.read',
  'ledger.read',
  'withdrawal.approve',
  'withdrawal.reject',
  'fraud.read',
  'fraud.resolve',
  'sar.read',
  'sar.update',
  'audit.read',
  'admin.manage',
  'system.health',
];

const ROLES: Array<{ name: string; description: string; permissions: string[] }> = [
  {
    name: 'root',
    description: 'Full access. Reserved for break-glass; rotate frequently.',
    permissions: PERMISSIONS,
  },
  {
    name: 'compliance_officer',
    description: 'KYC review, SAR queue, sanctions/PEP investigation.',
    permissions: ['user.read', 'kyc.read', 'kyc.review', 'kyc.approve', 'kyc.reject', 'sar.read', 'sar.update', 'audit.read'],
  },
  {
    name: 'fraud_analyst',
    description: 'Reviews fraud alerts, freezes accounts, escalates SARs.',
    permissions: ['user.read', 'user.suspend', 'fraud.read', 'fraud.resolve', 'transaction.read', 'audit.read'],
  },
  {
    name: 'treasury',
    description: 'Approves outbound stablecoin withdrawals, monitors liquidity.',
    permissions: ['wallet.read', 'transaction.read', 'ledger.read', 'withdrawal.approve', 'withdrawal.reject', 'system.health'],
  },
  {
    name: 'support_l1',
    description: 'Read-only customer support.',
    permissions: ['user.read', 'wallet.read', 'transaction.read'],
  },
];

async function main() {
  console.log('▶ Seeding system ledger accounts…');
  for (const acct of SYSTEM_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: acct.code },
      update: {},
      create: {
        code: acct.code,
        kind: acct.kind,
        currency: acct.currency,
        normalSide: acct.normalSide,
      },
    });
  }

  console.log('▶ Seeding permissions…');
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  console.log('▶ Seeding roles…');
  for (const role of ROLES) {
    const r = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
    for (const permKey of role.permissions) {
      const p = await prisma.permission.findUnique({ where: { key: permKey } });
      if (!p) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  console.log('▶ Seeding root admin…');
  const rootPasswordRaw = process.env.SEED_ROOT_PASSWORD ?? randomBytes(18).toString('base64url');
  const rootAdmin = await prisma.adminUser.upsert({
    where: { email: 'root@afristable.local' },
    update: {},
    create: {
      email: 'root@afristable.local',
      passwordHash: hashPassword(rootPasswordRaw),
    },
  });
  const rootRole = await prisma.role.findUnique({ where: { name: 'root' } });
  if (rootRole) {
    await prisma.adminRoleAssignment.upsert({
      where: { adminUserId_roleId: { adminUserId: rootAdmin.id, roleId: rootRole.id } },
      update: {},
      create: { adminUserId: rootAdmin.id, roleId: rootRole.id },
    });
  }

  console.log('▶ Seeding reference FX rates…');
  const rates: Array<[string, string, string]> = [
    ['USD', 'NGN', '1580.50'],
    ['USD', 'KES', '129.40'],
    ['USD', 'GHS', '15.20'],
    ['USD', 'ZAR', '18.35'],
    ['USDC', 'USD', '1.000'],
    ['USDT', 'USD', '1.000'],
    ['EUR', 'USD', '1.085'],
    ['GBP', 'USD', '1.265'],
  ];
  for (const [base, quote, rate] of rates) {
    await prisma.exchangeRate.create({
      data: { base, quote, rate, source: 'seed' },
    });
  }

  console.log('\n✔ Seed complete.');
  console.log('────────────────────────────────────────');
  console.log('  Root admin: root@afristable.local');
  if (!process.env.SEED_ROOT_PASSWORD) {
    console.log(`  Password:   ${rootPasswordRaw}`);
    console.log('  (set SEED_ROOT_PASSWORD to control this)');
  }
  console.log('────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
