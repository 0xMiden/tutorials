/** Sepolia — default for Cross-chain deposit `destinationChainId` and withdraw `sourceChainId`. */
export const DEFAULT_SEPOLIA_CHAIN_ID_STR = '11155111';

/**
 * Virtual chain id for Miden as intent *output* in EVM→Miden (`gettokenout` with Miden extraData).
 * Allocator SIO uses this for `tokenOut.chainId` with `getTokenDataFromMidenFaucetId`; epoch-sio treats 0 as Miden
 * (`MIDEN_CHAIN_ID` in epoch-sio/src/services/web3/safe.ts). Do not set to an EVM chain id for this flow.
 */
export const MIDEN_DESTINATION_CHAIN_ID = 999999999;
