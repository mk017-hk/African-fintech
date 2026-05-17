import type { PrismaClient } from '@afristable/database';

export interface AuditContext {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditEvent extends AuditContext {
  action: string;             // e.g. "auth.login.success"
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit logger. Never updates or deletes rows. Wrap in a try/catch
 * around any business operation if audit writes fail — the operation already
 * succeeded; we don't roll back business state to keep a log entry.
 */
export class AuditLogger {
  constructor(private readonly db: PrismaClient) {}

  async log(event: AuditEvent): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorType: event.actorType,
        actorId: event.actorId,
        userId: event.userId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        ip: event.ip,
        userAgent: event.userAgent,
        metadata: (event.metadata ?? {}) as object,
      },
    });
  }
}
