import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '@afristable/shared';
import type { PayoutAck, PayoutProvider, PayoutRequest } from '../types';

export interface OrangeConfig {
  baseUrl: string; clientId: string; clientSecret: string; webhookSecret: string;
}

const SUPPORTED = new Set(['XOF', 'XAF']);

export class OrangeMoneyProvider implements PayoutProvider {
  readonly name = 'orange';
  readonly kind = 'mobile_money' as const;
  constructor(private readonly cfg: OrangeConfig | null) {}

  validate(req: PayoutRequest) {
    if (!SUPPORTED.has(req.currency)) {
      return { ok: false as const, error: `Orange Money does not support ${req.currency}` };
    }
    const msisdn = (req.destination as { msisdnE164?: string }).msisdnE164;
    if (!msisdn) return { ok: false as const, error: 'Missing MSISDN' };
    return { ok: true as const };
  }

  async send(req: PayoutRequest): Promise<PayoutAck> {
    if (!this.cfg) throw ProviderError('orange', 'not configured');
    return { providerRef: `ORANGE_${req.reference}_${Date.now()}`, status: 'QUEUED' };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.cfg) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'hex'); const b = Buffer.from(signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
