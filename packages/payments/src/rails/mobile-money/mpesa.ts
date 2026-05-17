/**
 * M-Pesa adapter (Safaricom Daraja). Stub illustrating shape and signature
 * verification. Production: implement B2C (BusinessPayment) for payouts and
 * C2B for collections; rotate access tokens; verify webhook IPs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '@afristable/shared';
import type { PayoutAck, PayoutProvider, PayoutRequest } from '../types';

export interface MpesaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  webhookSecret: string; // shared secret negotiated for webhook HMAC
}

export class MpesaProvider implements PayoutProvider {
  readonly name = 'mpesa';
  readonly kind = 'mobile_money' as const;
  constructor(private readonly cfg: MpesaConfig | null) {}

  validate(req: PayoutRequest) {
    if (req.currency !== 'KES') return { ok: false as const, error: 'M-Pesa supports KES only' };
    const msisdn = (req.destination as { msisdnE164?: string }).msisdnE164;
    if (!msisdn || !/^\+2547\d{8}$/.test(msisdn)) {
      return { ok: false as const, error: 'Invalid Kenyan MSISDN (expected +2547XXXXXXXX)' };
    }
    return { ok: true as const };
  }

  async send(req: PayoutRequest): Promise<PayoutAck> {
    if (!this.cfg) throw ProviderError('mpesa', 'not configured');
    // TODO: 1) POST /oauth/v1/generate?grant_type=client_credentials with Basic auth
    //       2) POST /mpesa/b2c/v1/paymentrequest with our reference and msisdn
    //       3) handle Daraja's async callback model — actual completion comes via webhook
    return {
      providerRef: `MPESA_${req.reference}_${Date.now()}`,
      status: 'QUEUED',
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.cfg) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(payload).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
