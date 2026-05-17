import type { PayoutProvider } from './types';

export class PayoutRegistry {
  private readonly providers = new Map<string, PayoutProvider>();
  register(p: PayoutProvider) { this.providers.set(p.name, p); }
  get(name: string): PayoutProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`Payout provider not registered: ${name}`);
    return p;
  }
  list(): string[] { return [...this.providers.keys()]; }
}
