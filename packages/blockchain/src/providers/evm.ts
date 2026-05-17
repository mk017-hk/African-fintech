/**
 * EVM provider stub (Ethereum / Polygon / Base).
 *
 * In production, wire to a JSON-RPC client (viem / ethers / web3.js). This
 * stub validates addresses, simulates gas estimates, and exposes the right
 * shape so the rest of the system can be built and tested without an RPC.
 */
import { Money } from '@afristable/shared';
import type {
  Asset,
  BlockchainProvider,
  GasEstimate,
  Network,
  OnchainTransfer,
  TransactionSigner,
} from '../types';

const EVM_NETWORKS: Network[] = ['ETHEREUM', 'POLYGON', 'BASE'];

const DEFAULT_GAS_USD: Record<Network, string> = {
  ETHEREUM: '4.50',
  POLYGON:  '0.04',
  BASE:     '0.10',
  SOLANA:   '0.001',
  STELLAR:  '0.00001',
};

const NATIVE_SYMBOL: Record<Network, string> = {
  ETHEREUM: 'ETH', POLYGON: 'MATIC', BASE: 'ETH', SOLANA: 'SOL', STELLAR: 'XLM',
};

export class EvmProvider implements BlockchainProvider {
  readonly supportedAssets: ReadonlyArray<Asset> = ['USDC', 'USDT'];

  constructor(
    readonly network: Network,
    private readonly rpcUrl: string | undefined,
    private readonly contracts: Partial<Record<Asset, string>>,
  ) {
    if (!EVM_NETWORKS.includes(network)) {
      throw new Error(`EvmProvider does not support ${network}`);
    }
  }

  isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  async getConfirmations(txHash: string): Promise<number> {
    if (!this.rpcUrl) return 0;
    // TODO: viem getTransactionReceipt → blockNumber, then current head.
    void txHash;
    return 0;
  }

  async fetchIncoming(
    address: string,
    asset: Asset,
    fromBlock?: bigint,
  ): Promise<OnchainTransfer[]> {
    if (!this.rpcUrl || !this.contracts[asset]) return [];
    // TODO: query Transfer(address,address,uint256) logs filtered by `to == address`.
    void address; void fromBlock;
    return [];
  }

  async estimateGas(asset: Asset, _toAddress: string, _amount: Money): Promise<GasEstimate> {
    return {
      network: this.network,
      feeNative: '0.001',
      feeNativeSymbol: NATIVE_SYMBOL[this.network],
      feeUsd: DEFAULT_GAS_USD[this.network],
    };
  }

  async broadcastWithdrawal(opts: {
    asset: Asset;
    toAddress: string;
    amount: Money;
    signer: TransactionSigner;
    memo?: string;
  }): Promise<{ txHash: string }> {
    if (!this.isValidAddress(opts.toAddress)) {
      throw new Error('Invalid EVM address');
    }
    if (opts.signer.network !== this.network) {
      throw new Error('Signer network mismatch');
    }
    // TODO: build ERC-20 transfer calldata, EIP-1559 tx, sign via signer, send via eth_sendRawTransaction.
    // Returning a deterministic placeholder so callers can wire pipelines end-to-end.
    const fakeHash = '0x' + Buffer.from(`${this.network}|${opts.asset}|${opts.toAddress}|${opts.amount.toString()}|${Date.now()}`).toString('hex').slice(0, 64).padEnd(64, '0');
    return { txHash: fakeHash };
  }
}
