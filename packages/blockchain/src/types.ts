import type { Money } from '@afristable/shared';

export type Network = 'ETHEREUM' | 'POLYGON' | 'BASE' | 'SOLANA' | 'STELLAR';
export type Asset = 'USDC' | 'USDT';

export interface OnchainTransfer {
  txHash: string;
  network: Network;
  asset: Asset;
  fromAddress: string;
  toAddress: string;
  amount: Money;
  blockNumber: bigint;
  confirmations: number;
  memo?: string;
}

export interface GasEstimate {
  network: Network;
  /** Amount denominated in the chain's native gas currency (e.g. ETH, SOL). */
  feeNative: string;
  feeNativeSymbol: string;
  /** Best-effort USD-equivalent of the gas fee. */
  feeUsd: string;
}

/**
 * BlockchainProvider — the only way the rest of the system talks to a chain.
 *
 * Implementations must be:
 *   - read-only by default (`watchDeposits`, `getConfirmations`, `estimateGas`)
 *   - writes (`broadcastWithdrawal`) require a signer that LIVES IN THE
 *     CUSTODY MODULE — never in this library. The signer is passed in.
 */
export interface BlockchainProvider {
  readonly network: Network;
  readonly supportedAssets: ReadonlyArray<Asset>;

  isValidAddress(address: string): boolean;

  /** Confirmations of a known tx; 0 if not seen yet. */
  getConfirmations(txHash: string): Promise<number>;

  /** Read deposits to a given address since `fromBlock`. */
  fetchIncoming(address: string, asset: Asset, fromBlock?: bigint): Promise<OnchainTransfer[]>;

  estimateGas(asset: Asset, toAddress: string, amount: Money): Promise<GasEstimate>;

  /**
   * Broadcast a signed transaction. Signing is delegated to `signer` to keep
   * private keys outside this package. Returns the tx hash.
   */
  broadcastWithdrawal(opts: {
    asset: Asset;
    toAddress: string;
    amount: Money;
    signer: TransactionSigner;
    memo?: string;
  }): Promise<{ txHash: string }>;
}

/**
 * Abstract signer interface. The custody module produces the concrete
 * implementation (HSM, KMS, MPC, hot wallet). Never write a signer that
 * holds raw key material in process memory in production.
 */
export interface TransactionSigner {
  readonly network: Network;
  getAddress(): Promise<string>;
  /**
   * Sign an opaque payload. The provider serialises the unsigned tx; the
   * signer returns the signature bytes (or a fully-signed serialised tx).
   */
  sign(unsignedTx: Uint8Array): Promise<Uint8Array>;
}
