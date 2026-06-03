/**
 * Mock module for @miden-sdk/react.
 *
 * Usage in test files:
 *
 *   vi.mock('@miden-sdk/react', () => import('@/__tests__/mocks/miden-sdk-react'));
 *
 * Override specific hooks in individual tests:
 *
 *   import { useAccounts } from '@miden-sdk/react';
 *   vi.mocked(useAccounts).mockReturnValue({ wallets: [], ... });
 */

import { vi } from "vitest";
import {
  MOCK_WALLET_HEADER,
  MOCK_WALLET_HEADER_2,
  MOCK_FAUCET_HEADER,
  MOCK_ACCOUNT,
  MOCK_ASSET_BALANCE,
  MOCK_ASSET_METADATA,
  MOCK_INPUT_NOTE_RECORD,
  MOCK_CONSUMABLE_NOTE_RECORD,
  MOCK_NOTE_SUMMARY,
  MOCK_TRANSACTION_RESULT,
  MOCK_SEND_RESULT,
  FAUCET_ID,
} from "../fixtures";

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export const useAccounts = vi.fn(() => ({
  accounts: [MOCK_WALLET_HEADER, MOCK_WALLET_HEADER_2, MOCK_FAUCET_HEADER],
  wallets: [MOCK_WALLET_HEADER, MOCK_WALLET_HEADER_2],
  faucets: [MOCK_FAUCET_HEADER],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

export const useAccount = vi.fn(() => ({
  account: MOCK_ACCOUNT,
  assets: [MOCK_ASSET_BALANCE],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  getBalance: vi.fn((assetId: string) =>
    assetId === FAUCET_ID ? MOCK_ASSET_BALANCE.amount : 0n,
  ),
}));

export const useNotes = vi.fn(() => ({
  notes: [MOCK_INPUT_NOTE_RECORD],
  consumableNotes: [MOCK_CONSUMABLE_NOTE_RECORD],
  noteSummaries: [MOCK_NOTE_SUMMARY],
  consumableNoteSummaries: [MOCK_NOTE_SUMMARY],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

export const useSyncState = vi.fn(() => ({
  syncHeight: 12345,
  isSyncing: false,
  lastSyncTime: Date.now(),
  error: null,
  sync: vi.fn(),
}));

export const useAssetMetadata = vi.fn(() => ({
  assetMetadata: new Map([[FAUCET_ID, MOCK_ASSET_METADATA]]),
}));

export const useTransactionHistory = vi.fn(() => ({
  records: [],
  record: null,
  status: null,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

export const useNoteStream = vi.fn(() => ({
  notes: [],
  latest: null,
  markHandled: vi.fn(),
  markAllHandled: vi.fn(),
  snapshot: vi.fn(() => ({ ids: new Set<string>(), timestamp: Date.now() })),
  isLoading: false,
  error: null,
}));

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

// Mutation hooks that resolve to TransactionResult { transactionId } —
// useMint / useConsume / useSwap / useMultiSend / useTransaction.
function createMutationMock(mutateKey: string) {
  return vi.fn(() => ({
    [mutateKey]: vi.fn(async () => MOCK_TRANSACTION_RESULT),
    result: null,
    isLoading: false,
    stage: "idle" as const,
    error: null,
    reset: vi.fn(),
  }));
}

// useSend resolves to SendResult { txId, note } — not TransactionResult.
// Keep this separate so tests that call `send()` get the correct shape.
function createSendMock() {
  return vi.fn(() => ({
    send: vi.fn(async () => MOCK_SEND_RESULT),
    result: null,
    isLoading: false,
    stage: "idle" as const,
    error: null,
    reset: vi.fn(),
  }));
}

export const useCreateWallet = vi.fn(() => ({
  createWallet: vi.fn(async () => MOCK_ACCOUNT),
  wallet: null,
  isCreating: false,
  error: null,
  reset: vi.fn(),
}));

export const useCreateFaucet = vi.fn(() => ({
  createFaucet: vi.fn(async () => MOCK_ACCOUNT),
  faucet: null,
  isCreating: false,
  error: null,
  reset: vi.fn(),
}));

export const useSend = createSendMock();
export const useMultiSend = createMutationMock("sendMany");
export const useMint = createMutationMock("mint");
export const useConsume = createMutationMock("consume");
export const useSwap = createMutationMock("swap");
export const useTransaction = createMutationMock("execute");

export const useImportAccount = vi.fn(() => ({
  importAccount: vi.fn(async () => MOCK_ACCOUNT),
  account: null,
  isImporting: false,
  error: null,
  reset: vi.fn(),
}));

export const useInternalTransfer = vi.fn(() => ({
  transfer: vi.fn(async () => ({
    createTransactionId: "0xtx1",
    consumeTransactionId: "0xtx2",
    noteId: "0xnote1",
  })),
  transferChain: vi.fn(async () => []),
  result: null,
  isLoading: false,
  stage: "idle" as const,
  error: null,
  reset: vi.fn(),
}));

export const useWaitForCommit = vi.fn(() => ({
  waitForCommit: vi.fn(async () => undefined),
}));

export const useWaitForNotes = vi.fn(() => ({
  waitForConsumableNotes: vi.fn(async () => []),
}));

export const useSessionAccount = vi.fn(() => ({
  initialize: vi.fn(async () => undefined),
  sessionAccountId: null,
  isReady: false,
  step: "idle" as const,
  error: null,
  reset: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Provider hooks
// ---------------------------------------------------------------------------

export const useMiden = vi.fn(() => ({
  client: null,
  isReady: true,
  isInitializing: false,
  error: null,
  sync: vi.fn(),
  runExclusive: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  prover: null,
  signerAccountId: null,
  signerConnected: null,
}));

export const useMidenClient = vi.fn(() => ({}));

export const useSigner = vi.fn(() => null);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function MidenProvider({ children }: { children: React.ReactNode }) {
  return children;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export const formatAssetAmount = vi.fn(
  (amount: bigint, decimals = 8) =>
    (Number(amount) / 10 ** decimals).toFixed(decimals > 4 ? 4 : decimals),
);

export const parseAssetAmount = vi.fn(
  (input: string, decimals = 8) => BigInt(Math.round(parseFloat(input) * 10 ** decimals)),
);

export const toBech32AccountId = vi.fn((id: string) => id);
export const normalizeAccountId = vi.fn((id: string) => id);
export const accountIdsEqual = vi.fn((a: string, b: string) => a === b);

export const getNoteSummary = vi.fn(() => MOCK_NOTE_SUMMARY);
export const formatNoteSummary = vi.fn(() => "5.0 TEST");

export const readNoteAttachment = vi.fn(() => null);
export const createNoteAttachment = vi.fn(() => ({}));

export const clearMidenStorage = vi.fn(async () => undefined);
export const migrateStorage = vi.fn(async () => true);
export const createMidenStorage = vi.fn(() => ({
  get: vi.fn(() => null),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
}));

export const wrapWasmError = vi.fn((e: unknown) =>
  e instanceof Error ? e : new Error(String(e)),
);
export const waitForWalletDetection = vi.fn(async () => undefined);

export const SignerContext = {
  Provider: vi.fn(({ children }: { children: React.ReactNode }) => children),
};

export const bytesToBigInt = vi.fn(() => 0n);
export const bigIntToBytes = vi.fn(() => new Uint8Array());
export const concatBytes = vi.fn((...arrays: Uint8Array[]) => {
  const len = arrays.reduce((acc, a) => acc + a.length, 0);
  return new Uint8Array(len);
});
