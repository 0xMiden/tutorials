import { useMemo } from 'react';
import { useIntentTransactionStatus } from './useIntentTransactionStatus';
import type { IntentFlowStatus } from '../components/crosschain/IntentStatus';
import { MIDEN_CHAIN_ID } from '../lib/explorers';
import { selectDestinationSettlement } from '../lib/intentSettlement';

export function useIntentFlowStatus(
  userAddress?: string,
  intentNonce?: string,
  destinationChainId?: number,
) {
  const { statuses, isPolling, error } = useIntentTransactionStatus(userAddress, intentNonce);

  const status = useMemo<IntentFlowStatus | null>(() => {
    if (!userAddress || !intentNonce) return null;

    // The synthetic Miden settlement row (chainId === MIDEN_CHAIN_ID) carries the
    // Miden-side tx + note; keep it separate so midenTxId / midenStatus / midenNoteId
    // survive regardless of which chain is the intent destination.
    const midenRow = statuses.find((s) => Number(s.chainId) === MIDEN_CHAIN_ID);

    // Destination-chain-aware settlement: filter to the user's destination chain,
    // wait while any destination row is pending, take the *last* terminal-OK row.
    // Never treat the first non-Miden row as settlement (PR #199 review) — it can
    // be an intermediate allocator/Compact step.
    const { completed: destinationRow } = selectDestinationSettlement(
      statuses,
      destinationChainId,
    );

    const latest = statuses[statuses.length - 1];

    const midenNoteId =
      (midenRow as any)?.midenNoteId ?? (destinationRow as any)?.midenNoteId ?? undefined;

    return {
      evmCompleted: !!destinationRow,
      evmTransactionHash: destinationRow?.transactionHash ?? undefined,
      evmChainId: destinationRow?.chainId != null ? Number(destinationRow.chainId) : undefined,
      midenTxId: midenRow?.transactionHash ?? undefined,
      midenStatus: midenRow?.status != null ? String(midenRow.status) : undefined,
      midenNoteId,
      latestStatusLabel: latest?.status != null ? String(latest.status) : undefined,
      latestChainId: latest?.chainId != null ? String(latest.chainId) : undefined,
      statusCount: statuses.length,
    };
  }, [statuses, userAddress, intentNonce, destinationChainId]);

  return { status, statuses, isPolling, error };
}
