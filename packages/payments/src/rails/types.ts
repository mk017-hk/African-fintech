/**
 * Payment-rail adapter contracts. Each rail (mobile money, bank, card)
 * implements one of these. The transfer/withdrawal services depend on the
 * abstract interface, never on the concrete provider.
 */

export interface PayoutRequest {
  reference: string;             // our internal transactionId
  amount: string;                // decimal string
  currency: string;
  destination: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PayoutAck {
  providerRef: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  raw?: unknown;
}

export interface PayoutProvider {
  readonly name: string;
  readonly kind: 'mobile_money' | 'bank' | 'card';
  /** Validates destination shape and supported currency. */
  validate(req: PayoutRequest): { ok: true } | { ok: false; error: string };
  send(req: PayoutRequest): Promise<PayoutAck>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}
