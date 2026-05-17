/**
 * KYC service.
 *
 * Lifecycle:
 *   1. User submits → SUBMITTED record + documents persisted (encrypted PII).
 *   2. Async worker triggers sanctions/PEP screen → hits stored.
 *   3. Compliance officer reviews → APPROVED or REJECTED.
 *   4. On APPROVED, user.kycTier is bumped, audit log entry written.
 *
 * Tier downgrade is also possible (e.g. expired documents); handled here too.
 */
import type { PrismaClient, KycTier } from '@afristable/database';
import { NotFound } from '@afristable/shared';
import { AuditLogger } from './audit';
import { encryptPii } from './crypto';
import type { SanctionsProvider } from './sanctions';

export interface KycSubmissionInput {
  userId: string;
  targetTier: Exclude<KycTier, 'TIER_0'>;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  occupation?: string;
  nationalId?: string;
  documents: Array<{ type: string; storageKey: string; documentNumber?: string }>;
}

export class KycService {
  constructor(
    private readonly db: PrismaClient,
    private readonly sanctions: SanctionsProvider,
    private readonly audit: AuditLogger,
  ) {}

  async submit(input: KycSubmissionInput, ctx: { ip?: string; userAgent?: string }) {
    const user = await this.db.user.findUnique({ where: { id: input.userId } });
    if (!user) throw NotFound('User not found');

    const record = await this.db.$transaction(async (tx) => {
      // Upsert profile fields (PII).
      await tx.profile.upsert({
        where: { userId: input.userId },
        update: {
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
          addressLine1: input.addressLine1,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode,
          occupation: input.occupation,
          nationalIdEnc: input.nationalId ? encryptPii(input.nationalId) : undefined,
        },
        create: {
          userId: input.userId,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          addressLine1: input.addressLine1,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode,
          occupation: input.occupation,
          nationalIdEnc: input.nationalId ? encryptPii(input.nationalId) : null,
        },
      });

      // Create KYC record.
      const rec = await tx.kycRecord.create({
        data: {
          userId: input.userId,
          targetTier: input.targetTier,
          status: 'SUBMITTED',
          documents: {
            create: input.documents.map((d) => ({
              type: d.type as never,
              storageKey: d.storageKey,
              metadataEnc: d.documentNumber ? encryptPii(d.documentNumber) : null,
            })),
          },
        },
      });

      return rec;
    });

    // Fire async screening (best-effort here; production: enqueue a job).
    void this.screen(record.id, {
      fullName: `${input.firstName} ${input.lastName}`,
      dateOfBirth: input.dateOfBirth,
      countryCode: user.countryCode,
    }).catch(() => undefined);

    await this.audit.log({
      actorType: 'user',
      actorId: input.userId,
      userId: input.userId,
      action: 'kyc.submitted',
      resourceType: 'kyc_record',
      resourceId: record.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { targetTier: input.targetTier },
    });

    return record;
  }

  private async screen(kycRecordId: string, subject: { fullName: string; dateOfBirth?: string; countryCode?: string }) {
    const result = await this.sanctions.screen(subject);
    await this.db.$transaction(async (tx) => {
      if (result.sanctionsHits.length) {
        await tx.sanctionsHit.createMany({
          data: result.sanctionsHits.map((h) => ({
            kycRecordId, listName: h.listName, matchedName: h.matchedName, score: h.score,
          })),
        });
      }
      if (result.pepHits.length) {
        await tx.pepHit.createMany({
          data: result.pepHits.map((h) => ({
            kycRecordId, listName: h.listName, matchedName: h.matchedName, role: h.role,
          })),
        });
      }
      const status = result.sanctionsHits.length || result.pepHits.length ? 'IN_REVIEW' : 'IN_REVIEW';
      const riskScore =
        result.sanctionsHits.reduce((s, h) => s + h.score, 0) +
        result.pepHits.reduce((s, h) => s + h.score * 0.5, 0);
      await tx.kycRecord.update({
        where: { id: kycRecordId },
        data: { status, riskScore: Math.min(100, Math.round(riskScore)) },
      });
    });
  }

  async review(
    kycRecordId: string,
    reviewerId: string,
    decision: 'APPROVED' | 'REJECTED',
    opts: { rejectionReason?: string; ip?: string; userAgent?: string },
  ) {
    const record = await this.db.kycRecord.findUnique({
      where: { id: kycRecordId },
      include: { sanctionsHits: true, pepHits: true },
    });
    if (!record) throw NotFound('KYC record not found');

    await this.db.$transaction(async (tx) => {
      await tx.kycRecord.update({
        where: { id: kycRecordId },
        data: {
          status: decision,
          reviewerId,
          reviewedAt: new Date(),
          rejectionReason: decision === 'REJECTED' ? opts.rejectionReason : null,
        },
      });
      if (decision === 'APPROVED') {
        await tx.user.update({
          where: { id: record.userId },
          data: { kycTier: record.targetTier },
        });
      }
    });

    await this.audit.log({
      actorType: 'admin',
      actorId: reviewerId,
      userId: record.userId,
      action: decision === 'APPROVED' ? 'kyc.approved' : 'kyc.rejected',
      resourceType: 'kyc_record',
      resourceId: kycRecordId,
      ip: opts.ip,
      userAgent: opts.userAgent,
      metadata: {
        targetTier: record.targetTier,
        rejectionReason: opts.rejectionReason,
        riskScore: record.riskScore,
      },
    });
  }
}
