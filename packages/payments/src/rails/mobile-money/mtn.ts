import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '@afristable/shared';
import type { PayoutAck, PayoutProvider, PayoutRequest } from '../types';

export interface MtnConfig {
  baseUrl: string;
  subscriptionKey: string;
  apiUserId: string;
  apiKey: string;
  webhookSecret: string;
}

const MTN_SUPPORTED = new Set(['GHS', 'UGX', 'XAF', 'XOF', 'RWF']);

export class MtnMomoProvider implements PayoutProvider {
  readonly name = 'mtn';
  readonly kind = 'mobile_money' as const;
  constructor(private readonly cfg: MtnConfig | null) {}

  validate(req: PayoutRequest) {
    if (!MTN_SUPPORTED.has(req.currency)) {
      return { ok: false as const, error: `MTN does not support ${req.currency}` };
    }
    const msisdn = (req.destination as { msisdnE164?: string }).msisdnE164;
    if (!msisdn || !/^\+\d{7,15}$/.test(msisdn)) {
      return { ok: false as const, error: 'Invalid MSISDN' };
    }
    return { ok: true as const };
  }

  async send(req: PayoutRequest): Promise<PayoutAck> {
    if (!this.cfg) throw ProviderError('mtn', 'not configured');
    // TODO: token endpoint, then POST /disbursement/v1_0/transfer with X-Reference-Id
    return { providerRef: `MTN_${req.reference}_${Date.now()}`, status: 'QUEUED' };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.cfg) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'hex'); const b = Buffer.from(signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
