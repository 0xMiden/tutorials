import { useMemo } from 'react';
import { useIntentTransactionStatus } from './useIntentTransactionStatus';
import type { IntentFlowStatus } from '../components/crosschain/IntentStatus';
import { MIDEN_CHAIN_ID } from '../lib/explorers';

const TERMINAL_OK = new Set(['success', 'completed']);

export function useIntentFlowStatus(userAddress?: string, intentNonce?: string) {
  const { statuses, isPolling, error } = useIntentTransactionStatus(userAddress, intentNonce);

  const status = useMemo<IntentFlowStatus | null>(() => {
    if (!userAddress || !intentNonce) return null;

    // Per SIO contract: each row is either an EVM tx (compact deposit / Safe)
    // or a synthetic Miden settlement row with chainId === MIDEN_CHAIN_ID.
    const midenRow = statuses.find((s) => Number(s.chainId) === MIDEN_CHAIN_ID);
    const evmRow = statuses.find((s) => Number(s.chainId) !== MIDEN_CHAIN_ID);

    const completedEvm =
      evmRow && TERMINAL_OK.has(String(evmRow.status).toLowerCase()) && evmRow.transactionHash
        ? evmRow
        : undefined;
    const latest = statuses[statuses.length - 1];

    const midenNoteId =
      (midenRow as any)?.midenNoteId ?? (evmRow as any)?.midenNoteId ?? undefined;

    return {
      evmCompleted: !!completedEvm,
      evmTransactionHash: completedEvm?.transactionHash ?? evmRow?.transactionHash ?? undefined,
      evmChainId: evmRow?.chainId != null ? Number(evmRow.chainId) : undefined,
      midenTxId: midenRow?.transactionHash ?? undefined,
      midenStatus: midenRow?.status != null ? String(midenRow.status) : undefined,
      midenNoteId,
      latestStatusLabel: latest?.status != null ? String(latest.status) : undefined,
      latestChainId: latest?.chainId != null ? String(latest.chainId) : undefined,
      statusCount: statuses.length,
    };
  }, [statuses, userAddress, intentNonce]);

  return { status, statuses, isPolling, error };
}
