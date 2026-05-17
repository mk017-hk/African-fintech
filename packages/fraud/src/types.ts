import type { Money } from '@afristable/shared';
import type { PrismaClient, RiskSeverity } from '@afristable/database';

export type FraudAction = 'ALLOW' | 'REVIEW' | 'BLOCK';

export interface FraudDecision {
  action: FraudAction;
  score: number;            // 0-100
  reasons: FraudReason[];
}

export interface FraudReason {
  rule: string;
  severity: RiskSeverity;
  score: number;
  details: Record<string, unknown>;
}

export interface FraudContext {
  db: PrismaClient;
  userId: string;
  ip?: string;
  deviceFingerprint?: string;
  userAgent?: string;
  countryCode?: string;
}

export type FraudEventKind =
  | { kind: 'auth.login';        success: boolean }
  | { kind: 'auth.otp_attempt';  success: boolean }
  | { kind: 'transfer.initiate'; amountUsd: number; destinationKind: string; destinationRef?: string }
  | { kind: 'withdrawal.initiate'; amountUsd: number; rail: string; destinationRef: string }
  | { kind: 'wallet.address_added'; address: string; network: string };

export interface FraudRule {
  name: string;
  /** Returns `null` if rule does not match. */
  evaluate(event: FraudEventKind, ctx: FraudContext): Promise<FraudReason | null>;
}

export interface FraudThresholds {
  reviewAt: number;  // score ≥ this → manual review
  blockAt:  number;  // score ≥ this → outright block
}
