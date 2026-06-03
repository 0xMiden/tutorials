import { useMemo } from 'react';
import { useMidenWalletAdapterContext } from '../../hooks/MidenWalletAdapterProvider';
import { WithdrawForm } from '../crosschain/WithdrawForm';
import { IntentStatus, fallbackMidenNoteId } from '../crosschain/IntentStatus';
import { WithdrawConsume } from '../crosschain/WithdrawConsume';
import { useWithdrawIntent } from '../../hooks/useWithdrawIntent';
import { useIntentFlowStatus } from '../../hooks/useIntentFlowStatus';
import type { MidenAccount } from '../../types/miden';
import { MIDEN_DESTINATION_CHAIN_ID } from '../../constants/chains';

export function WithdrawTab() {
  // Read from the shared provider rather than firing a second
  // `useMidenWalletAdapter` instance.
  const midenWallet = useMidenWalletAdapterContext();
  const displayWallets: MidenAccount[] = useMemo(() => {
    if (!midenWallet.accountId?.hex) return [];
    return [
      {
        id: midenWallet.accountId.hex,
        label: 'Connected wallet',
        type: 'wallet' as const,
      },
    ];
  }, [midenWallet.accountId?.hex]);

  const withdraw = useWithdrawIntent();

  // Per INTEGRATION.md §10: userAddress is the EVM source for Flow B (set as `recipient`
  // on EVM→Miden intents — it's the refund target if the intent fails).
  const intentNonce = withdraw.withdrawResult?.intentNonce;
  const evmAddress = withdraw.withdrawResult?.intentData?.recipient as string | undefined;
  // EVM→Miden settles on Miden: the destination chain is the Miden virtual chain
  // id, so the synthetic Miden row is the settlement to wait on.
  const intentStatus = useIntentFlowStatus(evmAddress, intentNonce, MIDEN_DESTINATION_CHAIN_ID);

  return (
    <div className="ui-tab-panel space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900 sm:text-xl">Withdraw to Miden</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-600">
          Pull funds from your EVM wallet into a Miden account using an Epoch withdraw intent.
        </p>
      </header>
      <WithdrawForm
        accounts={displayWallets}
        onFetchQuote={withdraw.fetchQuote}
        onConfirmWithdraw={withdraw.confirmWithdraw}
        onClearQuote={withdraw.clearQuote}
        pendingQuote={withdraw.pendingQuote}
        isFetchingQuote={withdraw.isFetchingQuote}
        isLoading={withdraw.isLoading}
        isSDKReady={withdraw.isSDKReady}
      />
      <IntentStatus
        result={withdraw.withdrawResult}
        error={withdraw.error}
        flowStatus={intentStatus.status}
        isPolling={intentStatus.isPolling}
      />
      {/* P2ID note → spendable Miden balance. The allocator delivers the
          bridged funds as a P2ID note; in Miden's actor model that's not
          balance until the recipient account consumes it. Mount the panel only
          after a note id is available. */}
      {(() => {
        const noteId =
          intentStatus.status?.midenNoteId ?? fallbackMidenNoteId(withdraw.withdrawResult);
        return noteId ? (
          <WithdrawConsume noteId={noteId} midenAccountId={midenWallet.accountId?.hex} />
        ) : null;
      })()}
    </div>
  );
}
