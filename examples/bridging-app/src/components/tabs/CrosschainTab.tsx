import { IntentForm } from '../crosschain/IntentForm';
import { IntentStatus } from '../crosschain/IntentStatus';
import { useEpochIntent } from '../../hooks/useEpochIntent';
import { useIntentFlowStatus } from '../../hooks/useIntentFlowStatus';
import { useMidenWalletAdapter } from '../../hooks/useMidenWalletAdapter';

export function CrosschainTab() {
  const midenWallet = useMidenWalletAdapter({ enabled: true });

  const epoch = useEpochIntent();
  const intentNonce = epoch.intentResult?.intentNonce;
  const evmAddress = epoch.intentResult?.intentData?.recipient as string | undefined;
  const intentStatus = useIntentFlowStatus(evmAddress, intentNonce);

  return (
    <div className="ui-tab-panel space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900 sm:text-xl">Bridge to EVM</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-600">
          Connect an Ethereum wallet, pick your Miden wallet and token, then get a quote. Confirm to lock funds and
          submit the cross-chain intent.
        </p>
      </header>
      <IntentForm
        midenAccountId={midenWallet.accountId?.hex ?? null}
        midenAssets={midenWallet.assets}
        isLoadingMidenAssets={midenWallet.isLoadingAssets}
        onFetchQuote={epoch.fetchQuote}
        onConfirmIntent={epoch.confirmIntent}
        onClearQuote={epoch.clearQuote}
        pendingQuote={epoch.pendingQuote}
        isFetchingQuote={epoch.isFetchingQuote}
        isConfirmBusy={epoch.isLoading}
        isSDKReady={epoch.isSDKReady}
        intentNonce={intentNonce}
        intentUserAddress={evmAddress}
      />
      <IntentStatus
        result={epoch.intentResult}
        error={epoch.error}
        flowStatus={intentStatus.status}
        isPolling={intentStatus.isPolling}
      />
    </div>
  );
}
