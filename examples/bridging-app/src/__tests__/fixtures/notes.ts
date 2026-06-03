/**
 * Realistic note fixtures for Miden frontend tests.
 */

import { FAUCET_ID, WALLET_ID_1, WALLET_ID_2 } from "./accounts";

export const MOCK_NOTE_ASSET = {
  assetId: FAUCET_ID,
  amount: 500000000n, // 5.0 tokens with 8 decimals
  symbol: "TEST",
  decimals: 8,
};

export const MOCK_NOTE_SUMMARY = {
  id: "0xnote1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  assets: [MOCK_NOTE_ASSET],
  sender: WALLET_ID_2,
};

export const MOCK_INPUT_NOTE_RECORD = {
  id: () => "0xnote1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  assets: () => [{ faucetId: () => FAUCET_ID, amount: () => 500000000n }],
  metadata: () => ({
    sender: () => ({ toBech32: () => WALLET_ID_2 }),
    noteType: () => 1,
  }),
  status: () => "committed",
};

export const MOCK_CONSUMABLE_NOTE_RECORD = {
  ...MOCK_INPUT_NOTE_RECORD,
  accountId: WALLET_ID_1,
};
