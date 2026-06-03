/** Sepolia — default for Cross-chain deposit `destinationChainId` and withdraw `sourceChainId`. */
export const DEFAULT_SEPOLIA_CHAIN_ID_STR = '11155111';

/**
 * Virtual chain id for Miden as intent *output* in EVM→Miden (`gettokenout` with Miden extraData).
 * The Epoch allocator uses this value as `tokenOut.chainId` to resolve the Miden-native output side
 * via its faucet-id lookup. Do not set it to an EVM chain id for this flow.
 */
export const MIDEN_DESTINATION_CHAIN_ID = 999999999;
