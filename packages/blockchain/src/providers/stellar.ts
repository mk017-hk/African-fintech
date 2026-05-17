/**
 * Stellar provider stub. Wire to stellar-sdk in production.
 * Validates account IDs (G-prefixed) and supports USDC issued on Stellar.
 */
import { Money } from '@afristable/shared';
import type {
  Asset, BlockchainProvider, GasEstimate, OnchainTransfer, TransactionSigner,
} from '../types';

export class StellarProvider implements BlockchainProvider {
  readonly network = 'STELLAR' as const;
  readonly supportedAssets: ReadonlyArray<Asset> = ['USDC'];

  constructor(private readonly horizonUrl: string | undefined) {}

  isValidAddress(address: string): boolean {
    return /^G[A-Z2-7]{55}$/.test(address);
  }

  async getConfirmations(_txHash: string): Promise<number> { return 0; }

  async fetchIncoming(_address: string, _asset: Asset): Promise<OnchainTransfer[]> { return []; }

  async estimateGas(): Promise<GasEstimate> {
    return { network: 'STELLAR', feeNative: '0.00001', feeNativeSymbol: 'XLM', feeUsd: '0.00001' };
  }

  async broadcastWithdrawal(opts: {
    asset: Asset; toAddress: string; amount: Money; signer: TransactionSigner; memo?: string;
  }): Promise<{ txHash: string }> {
    if (!this.isValidAddress(opts.toAddress)) throw new Error('Invalid Stellar address');
    if (opts.signer.network !== 'STELLAR') throw new Error('Signer network mismatch');
    return { txHash: 'xlm_' + Buffer.from(`${opts.toAddress}|${Date.now()}`).toString('hex').slice(0, 62) };
  }
}
