export interface MidenAccount {
  id: string;
  label: string;
  type: 'wallet' | 'faucet';
}

export interface MidenFaucetInfo extends MidenAccount {
  type: 'faucet';
  symbol: string;
  /** Optional persisted label; decimals for math come from `useFaucetDecimals` (MidenClient + faucet component). */
  decimals?: number;
  maxSupply: string;
}

export interface VaultAsset {
  faucetId: string;
  amount: string;
}

export interface CrossChainIntentParams {
  midenAccountId: string;
  midenFaucetId: string;
  /** Set to use direct-bridge path (same-token). Omit/pass "0" to use minTokenOut reverse-quote route */
  midenAmount?: string;
  /** From `useFaucetDecimals(midenFaucetId).decimals` (same RPC path as dex-solver inventory). Required for scaling. */
  midenDecimals: number;
  /** Optional absolute reclaim height (block number) for P2IDE notes */
  midenReclaimHeight?: number;
  evmRecipient: string;
  destinationChainId: number;
  outputTokenAddress: string;
  outputTokenDecimals?: number;
  minTokenOut: string;
}

export interface EVMToMidenIntentParams {
  /** EVM chain where `evmTokenAddress` is deployed (align with wallet; mirrors deposit tab chain id). */
  sourceChainId: number;
  /**
   * Intent output chain: must be `MIDEN_DESTINATION_CHAIN_ID` (currently `999999999`) for Miden credit in this stack.
   * Maps to mandate `destinationChainId` in task data (SIO `tokenOut.chainId`); not the EVM `sourceChainId`.
   */
  destinationChainId: number;
  evmSourceAddress: string;
  evmTokenAddress: string;
  /** Human-readable EVM input amount. Omit, empty, or "0" to use reverse-quote path (EVM spend comes from quote). */
  evmAmount?: string;
  evmTokenDecimals?: number;
  midenRecipientId: string;
  midenFaucetId: string;
  /**
   * Withdraw flow no longer depends on frontend faucet-decimals.
   * Backend should derive decimals from `midenFaucetId` when needed.
   */
  midenDecimals?: number;
  /**
   * Minimum Miden-side output you want.
   * Reverse-quote path: paired with `tokenInAmount: "0"` so SIO derives required EVM `tokenIn`.
   * Forward path (when `evmAmount` is set): optional slippage floor on Miden output.
   */
  minTokenOut: string;
}

export interface IntentResult {
  taskTypeString: string;
  intentData: Record<string, unknown>;
  solveResult?: {
    resourceLockRequired?: boolean;
    transactions?: Array<{
      to: string;
      data: string;
      value?: string;
    }>;
    compact?: any;
    hash?: string;
    nonce?: string;
    /**
     * Client-side EVM deposit into The Compact contract (depositERC20AndRegister
     * / depositNativeAndRegister). Populated by the SDK after the user's wallet
     * signs the deposit tx; only present for EVM-collateral flows.
     */
    depositResult?: {
      success?: boolean;
      transactionHash?: string;
    };
  };
  error?: string;
  /** The intent nonce used for status tracking (userAddress:intentNonce in SIO) */
  intentNonce?: string;
  /** Chain id the compact deposit landed on (= source EVM chain). */
  depositChainId?: number;
}
