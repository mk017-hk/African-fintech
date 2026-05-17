# AfriStable Pay — Security Notes

This document captures the threat model, the controls already in place, and
the explicit gaps you must close before this system can hold real customer
funds. It is intentionally honest about what is and isn't done.

## 1. Threat model (abbreviated)

| Actor                | Goal                          | Mitigated by                                |
| -------------------- | ----------------------------- | ------------------------------------------- |
| Account takeover     | Drain victim's wallet         | Argon2id, rate limits, OTP, device trust, fraud rules, withdrawal approval queue |
| Insider              | Move funds, alter records     | RBAC + least-priv, append-only audit + ledger, dual control on approvals |
| Replay attack        | Charge twice                  | `Idempotency-Key` required, transactional outbox |
| Front-end tampering  | Manipulate amounts/rates      | All quotes server-generated + signed; client sends `quoteId` only |
| Webhook spoofing     | Fake provider confirmations   | Per-provider HMAC signature verification |
| Sanctions / AML      | Onboard prohibited entity     | KYC pipeline + sanctions/PEP screening + SAR queue |
| PII leak             | Expose customer data          | AES-256-GCM column encryption, no PII in logs (redact list) |
| Compromised host     | Steal in-memory secrets       | Secrets in env only; private keys NEVER in-process (custody signer) |

## 2. Controls already implemented

- **Auth**: argon2id passwords; short-lived JWT access; opaque rotating refresh tokens stored only as SHA-256 hashes; OTP with rate-limited attempts; device fingerprint (`IP|UA|Accept-Language`).
- **Account safety**: 5-failure lockout; suspended-status enforcement; session revocation.
- **Money safety**:
  - Double-entry ledger as single source of truth.
  - Wallet balance = projection of ledger; recomputed atomically per posting.
  - Postings validated balanced per-currency before write.
  - All money-moving DB transactions use `Serializable` isolation.
  - Idempotency table protects every money-moving POST.
  - Server-generated signed quotes (HMAC-SHA256) consumed atomically.
- **KYC limits**: per-tier daily / monthly / single-tx USD-equivalent limits enforced before posting.
- **Fraud engine**: rules for high-velocity, unusual country, new-device high-value, blacklisted address, shared device, first-large-transfer, OTP-brute-force. Decisions persist in `risk_events`; `REVIEW` opens a `fraud_alerts` entry.
- **Withdrawal gating**: above threshold → approval queue. Funds reserved in a `SUSPENSE` ledger account, never floating outside the books.
- **Audit log**: append-only `audit_logs` for auth, KYC, withdrawal, admin actions.
- **Webhook intake**: raw-body signature verification; dedupe via `sha256(provider:eventId)`; async processing by a dedicated worker.
- **HTTP hardening**: Helmet (CSP, frame-ancestors none, no referrer), strict CORS allowlist, strict cookies (httpOnly + SameSite=Strict + Secure in prod), global rate limit + per-route rate limit on auth endpoints.
- **PII**: AES-256-GCM column encryption for national IDs, bank destinations, document metadata.
- **Logging**: pino with redact list for Authorization, Cookie, webhook signatures, passwords, refresh tokens.

## 3. Gaps you MUST close before holding real money

These are deliberately not implemented inside this repo. Each is a discrete project.

1. **Custody / signing key management**
   The `TransactionSigner` interface exists but the on-chain `broadcastWithdrawal`
   path returns a placeholder hash. Wire to an HSM (AWS CloudHSM,
   YubiHSM, KMS-backed signer) or an MPC provider (Fireblocks, Fordefi).
   **Do not hold private keys in process memory.**

2. **Secret management**
   `PII_ENCRYPTION_KEY`, JWT secrets, quote signing key, and webhook secrets
   are env-loaded. In production, source them from a vault (AWS Secrets
   Manager, HashiCorp Vault) at boot and never write them to disk. Rotate on
   a schedule and version the encrypted payload prefix (`v1:` → `v2:`).

3. **Sanctions / PEP / KYC provider wiring**
   `StubSanctionsProvider` is a tiny static list. Wire to a real provider
   (ComplyAdvantage, Refinitiv, Sayari) and store provider request/response
   IDs for regulator-grade traceability.

4. **Admin MFA**
   The schema reserves `totpSecretEnc` and the login flow accepts a `totp`
   field, but verification is left for you to wire to your TOTP library of
   choice. **Require hardware-key (WebAuthn) MFA for any admin with
   `withdrawal.approve` or `admin.manage`.**

5. **Dual control on high-value approvals**
   The current approval flow is single-officer. Add a "second approver"
   requirement above a configurable threshold and prevent the same admin from
   self-approving their own changes.

6. **Reconciliation jobs**
   `assertBooksBalance` and `walletProjectionDrift` exist but are not yet
   scheduled. Run them nightly with PagerDuty integration. ANY drift halts
   money movements until investigated.

7. **WAF + DDoS at the edge**
   Cloudflare / AWS WAF in front of the API. Per-IP and per-user rate limits
   in this repo are a backstop, not a substitute.

8. **PII access logging**
   Reads of `decryptPii` should themselves log to `audit_logs`. The helper
   currently does not enforce this; wrap it at the service boundary.

9. **Encrypted backups + key escrow**
   Postgres backups must be encrypted, and the PII key must be backed up to a
   separate key escrow with break-glass procedures.

10. **Pen test + bug bounty**
    Before launch, commission an external pen test focused on the money
    movement paths and webhook intake. Open a bug bounty before public launch.

## 4. Operating rules

- Never log webhook bodies, OTP codes, refresh tokens, or PII fields. The
  pino redact list covers the obvious ones; review your route handlers.
- Never run `prisma migrate reset` against a production cluster. Migrations
  must be forward-only with explicit data backfills.
- Treat the `root` admin role as break-glass only. Operators should hold
  scoped roles (`compliance_officer`, `fraud_analyst`, `treasury`).
- Any change to `packages/ledger` must be paired with a migration and a
  reconciliation pass on a copy of production data.

## 5. Reporting vulnerabilities

Security issues: `security@afristable.example` (replace with the real address).
Please do not file public issues for vulnerabilities.
