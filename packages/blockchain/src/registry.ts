import type { BlockchainProvider, Network } from './types';

export class ProviderNotConfigured extends Error {
  constructor(network: Network) {
    super(`Blockchain provider not configured for ${network}`);
    this.name = 'ProviderNotConfigured';
  }
}

export class ChainRegistry {
  private readonly providers = new Map<Network, BlockchainProvider>();

  register(provider: BlockchainProvider): void {
    this.providers.set(provider.network, provider);
  }

  get(network: Network): BlockchainProvider {
    const p = this.providers.get(network);
    if (!p) throw new ProviderNotConfigured(network);
    return p;
  }

  has(network: Network): boolean { return this.providers.has(network); }
  list(): Network[] { return [...this.providers.keys()]; }
}
