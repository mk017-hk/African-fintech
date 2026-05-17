import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '@afristable/shared';
import type { PayoutAck, PayoutProvider, PayoutRequest } from '../types';

export interface FlutterwaveConfig {
  baseUrl: string;
  secretKey: string;
  webhookSecret: string;
}

export class FlutterwaveProvider implements PayoutProvider {
  readonly name = 'flutterwave';
  readonly kind = 'bank' as const;
  constructor(private readonly cfg: FlutterwaveConfig | null) {}

  validate(req: PayoutRequest) {
    const d = req.destination as { accountNumber?: string; bankCode?: string };
    if (!d.accountNumber || !d.bankCode) return { ok: false as const, error: 'accountNumber and bankCode required' };
    if (!/^[A-Z]+$/.test(req.currency)) return { ok: false as const, error: 'Invalid currency' };
    return { ok: true as const };
  }

  async send(req: PayoutRequest): Promise<PayoutAck> {
    if (!this.cfg) throw ProviderError('flutterwave', 'not configured');
    // TODO: POST /transfers with Authorization: Bearer <secretKey>; idempotency via `reference`.
    return { providerRef: `FLW_${req.reference}_${Date.now()}`, status: 'QUEUED' };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.cfg) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'hex'); const b = Buffer.from(signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
