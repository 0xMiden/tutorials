/**
 * Test fixtures for Miden frontend tests.
 * Uses hex IDs (network-agnostic) and BigInt amounts matching real SDK shapes.
 * These are mock values — never parsed by the real SDK at runtime.
 */

export const WALLET_ID_1 = "0x0a00000000000001";
export const WALLET_ID_2 = "0x0a00000000000002";
export const FAUCET_ID = "0x0a00000000000003";
export const COUNTER_ID = "0x0a00000000000004";

export const MOCK_WALLET_HEADER = {
  id: WALLET_ID_1,
  nonce: 1n,
  storageCommitment: "0x0000000000000000000000000000000000000000000000000000000000000001",
};

export const MOCK_WALLET_HEADER_2 = {
  id: WALLET_ID_2,
  nonce: 0n,
  storageCommitment: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

export const MOCK_FAUCET_HEADER = {
  id: FAUCET_ID,
  nonce: 5n,
  storageCommitment: "0x0000000000000000000000000000000000000000000000000000000000000005",
};

export const MOCK_ASSET_BALANCE = {
  assetId: FAUCET_ID,
  amount: 1000000000n, // 10.0 tokens with 8 decimals
  symbol: "TEST",
  decimals: 8,
};

export const MOCK_ASSET_BALANCE_EMPTY = {
  assetId: FAUCET_ID,
  amount: 0n,
  symbol: "TEST",
  decimals: 8,
};

export const MOCK_ACCOUNT = {
  id: WALLET_ID_1,
  nonce: 1n,
  bech32id: () => WALLET_ID_1,
};

export const MOCK_ASSET_METADATA = {
  assetId: FAUCET_ID,
  symbol: "TEST",
  decimals: 8,
};

// TransactionResult shape — matches @miden-sdk/react types for useMint / useConsume /
// useSwap / useMultiSend / useTransaction result payloads.
export const MOCK_TRANSACTION_RESULT = {
  transactionId: "0xabc123def456789012345678901234567890123456789012345678901234abcd",
};

// SendResult shape — distinct from TransactionResult. @miden-sdk/react's useSend
// returns { txId, note }, not { transactionId }. Keep these fixtures separate so
// mocks for useSend don't bleed into mocks for TransactionResult-typed hooks.
export const MOCK_SEND_RESULT = {
  txId: "0xabc123def456789012345678901234567890123456789012345678901234abcd",
  note: null,
};
