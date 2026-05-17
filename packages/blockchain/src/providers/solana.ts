/**
 * Solana provider stub. Wire to @solana/web3.js + spl-token in production.
 * Validates base58 addresses and SPL-token transfers.
 */
import { Money } from '@afristable/shared';
import type {
  Asset, BlockchainProvider, GasEstimate, OnchainTransfer, TransactionSigner,
} from '../types';

export class SolanaProvider implements BlockchainProvider {
  readonly network = 'SOLANA' as const;
  readonly supportedAssets: ReadonlyArray<Asset> = ['USDC', 'USDT'];

  constructor(private readonly rpcUrl: string | undefined) {}

  isValidAddress(address: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  async getConfirmations(_txHash: string): Promise<number> { return 0; }

  async fetchIncoming(_address: string, _asset: Asset): Promise<OnchainTransfer[]> { return []; }

  async estimateGas(): Promise<GasEstimate> {
    return { network: 'SOLANA', feeNative: '0.000005', feeNativeSymbol: 'SOL', feeUsd: '0.001' };
  }

  async broadcastWithdrawal(opts: {
    asset: Asset; toAddress: string; amount: Money; signer: TransactionSigner; memo?: string;
  }): Promise<{ txHash: string }> {
    if (!this.isValidAddress(opts.toAddress)) throw new Error('Invalid Solana address');
    if (opts.signer.network !== 'SOLANA') throw new Error('Signer network mismatch');
    return { txHash: 'sol_' + Buffer.from(`${opts.toAddress}|${Date.now()}`).toString('hex').slice(0, 62) };
  }
}
