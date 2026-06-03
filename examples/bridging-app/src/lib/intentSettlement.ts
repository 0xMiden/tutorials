// Destination-chain-aware settlement selection for Epoch intent status rows.
//
// `getIntentStatus` returns one row per settlement step. The naive "first row
// whose chainId !== MIDEN_CHAIN_ID" heuristic can surface an intermediate
// allocator/Compact row instead of the user's actual destination settlement
// (see tutorials PR #199 review). This helper instead:
//
//   1. filters rows to the user-selected destination chain id,
//   2. refuses to report completion while any destination-chain row is still
//      `pending`, and
//   3. returns the *last* terminal-OK destination row.
//
// Shared by `useIntentFlowStatus` (status panel) and `IntentForm` (in-form
// summary) so both consumers agree on what "settled" means.

const TERMINAL_OK = new Set(['success', 'completed']);
const PENDING = new Set(['pending']);

/** Structural shape of an Epoch status row (a superset of the SDK's `IntentTransactionStatus`). */
export interface IntentStatusRow {
  status?: unknown;
  transactionHash?: unknown;
  chainId?: unknown;
}

export interface DestinationSettlement<T> {
  /** The last terminal-OK row on the destination chain, or undefined if none. */
  completed: T | undefined;
  /** True while any destination-chain row is still pending. */
  hasPending: boolean;
}

/**
 * Select the destination-chain settlement row from a list of intent status rows.
 *
 * When `destinationChainId` is missing or invalid the result is "incomplete"
 * (`completed: undefined`) rather than a silent fallback to the first non-Miden
 * row — callers should still surface latest-status display data separately.
 */
export function selectDestinationSettlement<T extends IntentStatusRow>(
  rows: readonly T[],
  destinationChainId: number | undefined,
): DestinationSettlement<T> {
  if (
    destinationChainId == null ||
    !Number.isInteger(destinationChainId) ||
    destinationChainId <= 0
  ) {
    return { completed: undefined, hasPending: false };
  }

  const destinationRows = rows.filter((s) => Number(s.chainId) === destinationChainId);
  const hasPending = destinationRows.some((s) =>
    PENDING.has(String(s.status).toLowerCase()),
  );
  // Pending destination row blocks completion; otherwise the *last* terminal-OK
  // row wins. Reverse-then-find because the ES2023 last-match array helper is
  // unavailable under this repo's ES2022 tsconfig target.
  const completed = hasPending
    ? undefined
    : [...destinationRows].reverse().find(
        (s) =>
          TERMINAL_OK.has(String(s.status).toLowerCase()) &&
          typeof s.transactionHash === 'string' &&
          s.transactionHash.length > 0,
      );
  return { completed, hasPending };
}

/**
 * Parse a destination chain id from submitted intent data. `buildEpochTaskDataParams`
 * stores it as `destinationChainId: String(params.destinationChainId)`, so the value
 * arrives as a string; returns undefined if absent or not a positive integer.
 */
export function parseDestinationChainId(raw: unknown): number | undefined {
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
