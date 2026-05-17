# AfriStable Pay

Stablecoin-powered global money platform for Africa.

This repository is a serious foundation — not a demo. It treats money like real
money: every value movement goes through a double-entry ledger, every quote is
signed server-side, every off-platform withdrawal passes risk scoring and (above
threshold) human approval, every action is auditable. The codebase is laid out
so it can grow into regulated infrastructure.

## What's inside

```
apps/
  api/                Fastify backend (HTTP + BullMQ workers)
  web/                Next.js 14 (user app + admin)
packages/
  shared/             Money math, errors, DTOs, Zod schemas
  database/           Prisma schema + seed
  config/             Strongly-typed env loader
  ledger/             Double-entry ledger (the only writer of balances)
  compliance/         KYC, sanctions/PEP, AML limits, audit, PII encryption
  fraud/              Rule engine + risk scoring
  payments/           Quote engine, transfer/withdrawal services, rail adapters
  blockchain/         Chain provider abstraction (EVM, Solana, Stellar)
infra/docker/         Local Postgres + Redis + API + web
.env.example          Every env var the system can use
SECURITY.md           Threat model, controls, what's intentionally not built
apps/api/openapi.yaml API contract
```

## Local quick start

```bash
# 1. Install
corepack enable
pnpm install

# 2. Copy env template
cp .env.example .env
# Generate real secrets:
#   openssl rand -hex 32   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, QUOTE_SIGNING_KEY, WEBHOOK_SIGNING_SECRET
#   openssl rand -hex 32   # PII_ENCRYPTION_KEY (must be exactly 64 hex chars = 32 bytes)

# 3. Bring up Postgres + Redis
pnpm docker:up

# 4. Migrate + seed
pnpm db:generate
pnpm db:migrate
pnpm db:seed     # prints the root admin password ONCE — save it

# 5. Run API + web in two terminals
pnpm api:dev
pnpm web:dev

# Web at  http://localhost:3000
# API at  http://localhost:4000
# Admin   http://localhost:3000/admin (sign in via /v1/admin/login first)
```

## Key invariants

1. **No balance is updated outside the ledger.** `wallet.availableBalance` is a
   *projection* maintained by `LedgerService.recomputeWalletBalance`. Any code
   that mutates the wallet directly is broken — code review must reject it.
2. **All quotes are server-generated, signed (HMAC-SHA256), and time-boxed.**
   Clients never send raw amounts to money-moving endpoints; they send a
   `quoteId`. Quotes are single-use; consumption + transfer happen in one DB
   transaction.
3. **Every money-moving POST is idempotent.** `Idempotency-Key` header is
   required. Replays with the same body return the cached response; replays
   with a different body are rejected with `409 IDEMPOTENCY_MISMATCH`.
4. **Withdrawals above `WITHDRAWAL_AUTO_APPROVE_USD` (default $1k) or any
   `REVIEW` fraud decision go to the approval queue.** Funds are reserved by
   debiting the user wallet into a `SUSPENSE` account; on approval, suspense →
   external rail; on rejection, suspense → wallet.
5. **All secrets via env, validated at boot.** `packages/config` fails fast if
   anything is missing or malformed. Production should source these from a KMS.
6. **PII is encrypted at rest.** `encryptPii` (AES-256-GCM) wraps national IDs,
   bank destinations, and document metadata.

## Architecture sketch

```
Client → Fastify → DomainServices → LedgerService → PostgreSQL
                              └────→ FraudEngine ──→ risk_events / fraud_alerts
                              └────→ QuoteService ─→ payment_quotes (signed)
                              └────→ Outbox ───────→ BullMQ workers ─→ Rail providers
                                                                        Chain providers
```

- **Fastify** for the HTTP layer (Helmet, CORS, rate limit, cookies).
- **PostgreSQL via Prisma** as the system of record. Serializable isolation
  on all money-moving transactions.
- **Redis + BullMQ** for queues. A transactional outbox guarantees we never
  enqueue work for a transaction we haven't committed.
- **Workers** (`apps/api/src/workers`): outbox dispatcher, chain indexer,
  webhook processor, payout dispatcher.
- **Provider adapters** for every external rail are behind an interface;
  swapping or adding one does not touch the transfer/withdrawal services.

## How a transfer flows

```
POST /v1/quotes          → server computes rate + spread + fee, signs, stores
POST /v1/transfers       → consume quote inside DB tx
                          → assertWalletHasFunds  (live ledger read)
                          → limits.assertWithinLimits (KYC tier)
                          → fraud.evaluate
                              ALLOW  → ledger.post (debit sender, credit receiver, credit fee)
                              REVIEW → approval queue
                              BLOCK  → reject + audit
                          → write audit_log
                          → outbox row for downstream notifications
```

## Tests

Per-package vitest specs covering the security-critical paths:

```bash
pnpm -r test
```

Add `--reporter=verbose` for full output. Integration tests against a real DB
should run inside a per-test transaction that is rolled back; the schema is
already shaped to support that pattern.

## Adding a new payment rail

1. Implement `PayoutProvider` (see `packages/payments/src/rails/types.ts`).
2. Register it in `apps/api/src/container.ts`.
3. Add a `withdrawal.dispatch.<rail>` topic to `payout-dispatcher.ts`.
4. Add provider-specific webhook signature verification.
5. Add provider env keys to `packages/config/src/index.ts` and `.env.example`.

## Adding a new blockchain

1. Implement `BlockchainProvider` in `packages/blockchain/src/providers/`.
2. Register it in `apps/api/src/container.ts` via `chains.register(...)`.
3. Add its enum value to `BlockchainNetwork` in `prisma/schema.prisma` and
   migrate.
4. Wire the signer (HSM/MPC); never check raw private keys into the repo.

## What is intentionally NOT built yet

See `SECURITY.md` for the threat model and a list of controls that need to be
finished before this can hold real money. Highlights:

- Custody signer integration (only the interface exists).
- Per-environment KMS for the PII key (current key is read from env).
- Real sanctions/PEP provider wiring (a stub is bundled for development).
- Hardware-key admin MFA and break-glass logging.
- WAF + DDoS protection at the edge.

## License

UNLICENSED. Internal foundation for AfriStable Pay.
