/**
 * FraudEngine — composes rules into a single decision.
 *
 * Decision logic:
 *   total = Σ rule.score
 *   highest severity = max(severities)
 *   total ≥ blockAt     → BLOCK
 *   total ≥ reviewAt    → REVIEW
 *   any CRITICAL match  → BLOCK regardless of total
 *   otherwise           → ALLOW
 *
 * Every evaluation also persists a `risk_events` row per matching rule and,
 * on REVIEW/BLOCK, a `fraud_alerts` entry for the analyst queue.
 */
import type { PrismaClient } from '@afristable/database';
import { ALL_RULES } from './rules';
import type {
  FraudContext,
  FraudDecision,
  FraudEventKind,
  FraudRule,
  FraudThresholds,
} from './types';

export class FraudEngine {
  private readonly thresholds: FraudThresholds;
  private readonly rules: FraudRule[];

  constructor(
    private readonly db: PrismaClient,
    opts?: { thresholds?: FraudThresholds; rules?: FraudRule[] },
  ) {
    this.thresholds = opts?.thresholds ?? { reviewAt: 40, blockAt: 80 };
    this.rules = opts?.rules ?? ALL_RULES;
  }

  async evaluate(
    event: FraudEventKind,
    ctx: Omit<FraudContext, 'db'>,
  ): Promise<FraudDecision> {
    const fullCtx: FraudContext = { ...ctx, db: this.db };
    const matched = (
      await Promise.all(this.rules.map((r) => r.evaluate(event, fullCtx)))
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    const totalScore = matched.reduce((s, r) => s + r.score, 0);
    const hasCritical = matched.some((r) => r.severity === 'CRITICAL');

    let action: FraudDecision['action'] = 'ALLOW';
    if (hasCritical || totalScore >= this.thresholds.blockAt) action = 'BLOCK';
    else if (totalScore >= this.thresholds.reviewAt) action = 'REVIEW';

    // Persist forensic record of every match.
    if (matched.length) {
      await this.db.riskEvent.createMany({
        data: matched.map((r) => ({
          userId: ctx.userId,
          rule: r.rule,
          severity: r.severity,
          score: r.score,
          details: r.details as object,
        })),
      });
    }

    // Open a fraud alert when action requires human attention.
    if (action !== 'ALLOW') {
      const top = matched.sort((a, b) => b.score - a.score)[0];
      if (top) {
        await this.db.fraudAlert.create({
          data: {
            userId: ctx.userId,
            rule: top.rule,
            severity: top.severity,
            details: {
              eventKind: event.kind,
              totalScore,
              matched: matched.map((r) => ({ rule: r.rule, score: r.score })),
            } as object,
          },
        });
      }
    }

    return { action, score: totalScore, reasons: matched };
  }
}
