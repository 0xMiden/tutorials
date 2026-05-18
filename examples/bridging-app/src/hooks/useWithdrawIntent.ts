import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import {
  buildEVMToMidenIntent,
  getEVMToMidenQuote,
  type EVMToMidenQuote,
} from '../services/epoch-bridge';
import type { EVMToMidenIntentParams, IntentResult } from '../types/miden';

export function useWithdrawIntent() {
  const [withdrawResult, setWithdrawResult] = useState<IntentResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<EVMToMidenQuote | null>(null);
  const [sdk, setSdk] = useState<any>(null);

  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  useEffect(() => {
    if (!walletClient) {
      setSdk(null);
      return;
    }
    let cancelled = false;
    import('@epoch-protocol/epoch-intents-sdk').then(({ EpochIntentSDK }) => {
      if (cancelled) return;
      const apiBaseUrl = import.meta.env.VITE_ALLOCATOR_URL || 'http://localhost:3000';
      console.log('apiBaseUrl: ', apiBaseUrl);
      setSdk(new EpochIntentSDK({ apiBaseUrl, walletClient: walletClient as any }));
    }).catch((err) => {
      if (cancelled) return;
      console.error('[Withdraw] Failed to load Epoch SDK:', err);
      setSdk(null);
    });
    return () => {
      cancelled = true;
    };
  }, [walletClient]);

  const fetchQuote = useCallback(
    async (params: EVMToMidenIntentParams) => {
      if (!sdk) throw new Error('Epoch SDK not ready — connect your EVM wallet');
      if (!address) throw new Error('Connect EVM wallet first');
      setIsFetchingQuote(true);
      setError(null);
      setPendingQuote(null);
      try {
        const quote = await getEVMToMidenQuote(sdk, params, address);
        if (!quote.quoteResult.tokenIn || quote.quoteResult.tokenIn === '0') {
          throw new Error('Quote returned no EVM input amount — try different minTokenOut or token pair');
        }
        setPendingQuote(quote);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Quote failed';
        setError(msg);
        throw err;
      } finally {
        setIsFetchingQuote(false);
      }
    },
    [sdk, address],
  );

  const confirmWithdraw = useCallback(async () => {
    if (!sdk) throw new Error('Epoch SDK not ready');
    if (!address) throw new Error('Connect EVM wallet first');
    if (!pendingQuote) throw new Error('Fetch a quote first');
    setIsLoading(true);
    setError(null);
    setWithdrawResult(null);
    try {
      const result = await buildEVMToMidenIntent(sdk, {
        ...pendingQuote.params,
        evmSourceAddress: address,
        preFetchedQuote: pendingQuote,
      });
      const r = result as any;
      const isNonceLike = (v: unknown) =>
        typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint';
      const rawNonce = isNonceLike(r?.intentNonce)
        ? r.intentNonce
        : isNonceLike(r?.solveResult?.nonce)
          ? r.solveResult.nonce
          : isNonceLike(r?.solveResult?.submittedIntentData?.nonce)
            ? r.solveResult.submittedIntentData.nonce
            : isNonceLike(r?.solveResult?.compact?.nonce)
              ? r.solveResult.compact.nonce
              : undefined;
      const nonce = rawNonce != null ? String(rawNonce) : undefined;
      console.log('[useWithdrawIntent] extracted nonce', { nonce, raw: rawNonce, solveResult: r?.solveResult });
      // Chain the deposit tx landed on — taken from the wallet client at submit
      // time; this is the chain where `depositERC20AndRegister` was called.
      const depositChainId = walletClient?.chain?.id;
      const resultWithNonce: IntentResult = {
        ...(result as IntentResult),
        ...(nonce ? { intentNonce: nonce } : {}),
        ...(depositChainId != null ? { depositChainId } : {}),
      };
      setWithdrawResult(resultWithNonce);
      setPendingQuote(null);
      return resultWithNonce;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm withdraw intent';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sdk, address, pendingQuote, walletClient]);

  const clearQuote = useCallback(() => {
    setPendingQuote(null);
    setError(null);
  }, []);

  return {
    fetchQuote,
    confirmWithdraw,
    clearQuote,
    pendingQuote,
    withdrawResult,
    isLoading,
    isFetchingQuote,
    error,
    address,
    isSDKReady: !!sdk,
  };
}
