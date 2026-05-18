import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import {
  buildCrossChainIntent,
  getCrossChainQuote,
  type CrossChainQuote,
} from '../services/epoch-bridge';
import type { CrossChainIntentParams, IntentResult } from '../types/miden';
import { CollateralType, type SolveIntentParams } from '@epoch-protocol/epoch-intents-sdk/dist/types';

export function useEpochIntent() {
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<CrossChainQuote | null>(null);
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
      const midenWalletClient = {
        ...(walletClient as any),
        chain: { ...((walletClient as any)?.chain ?? {}), id: 999999999 },
      };
      setSdk(new EpochIntentSDK({ apiBaseUrl, walletClient: midenWalletClient }));
    }).catch((err) => {
      if (cancelled) return;
      console.error('[CrossChain] Failed to load Epoch SDK:', err);
      setSdk(null);
    });
    return () => { cancelled = true; };
  }, [walletClient]);

  /** Step 1: fetch a reverse quote (tokenInAmount=0 → backend computes required Miden input). */
  const fetchQuote = useCallback(async (params: CrossChainIntentParams) => {
    if (!sdk) throw new Error('Epoch SDK not ready — connect EVM wallet first');
    if (!address) throw new Error('Connect EVM wallet first');
    setIsFetchingQuote(true);
    setError(null);
    setPendingQuote(null);
    try {
      const quote = await getCrossChainQuote(sdk, params, address);
      setPendingQuote(quote);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Quote failed';
      setError(msg);
      throw err;
    } finally {
      setIsFetchingQuote(false);
    }
  }, [sdk, address]);

  /** Step 2: execute the stored quote by creating the P2ID note and submitting the intent. */
  const confirmIntent = useCallback(async (
    createMidenP2IDNote: SolveIntentParams['createMidenP2IDNote'],
  ) => {
    if (!sdk) throw new Error('Epoch SDK not ready');
    if (!pendingQuote) throw new Error('Fetch a quote first');
    setIsLoading(true);
    setError(null);
    setIntentResult(null);
    try {
      const result = await buildCrossChainIntent(sdk, {
        ...pendingQuote.params,
        collateralType: CollateralType.Miden,
        midenSourceAccount: pendingQuote.params.midenAccountId,
        createMidenP2IDNote,
        preFetchedQuote: pendingQuote,
      });
      if (result?.error) {
        // Keep the existing quote visible so user can retry confirmation.
        setIntentResult(result);
        setError(result.error);
        throw new Error(result.error);
      }
      setIntentResult(result);
      setPendingQuote(null);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm intent';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sdk, pendingQuote]);

  /** Direct-bridge path: skip quote, call buildCrossChainIntent with explicit midenAmount. */
  const submitDirectIntent = useCallback(async (
    params: CrossChainIntentParams,
    createMidenP2IDNote: SolveIntentParams['createMidenP2IDNote'],
  ) => {
    if (!sdk) throw new Error('Epoch SDK not ready');
    setIsLoading(true);
    setError(null);
    setIntentResult(null);
    try {
      const result = await buildCrossChainIntent(sdk, {
        ...params,
        collateralType: CollateralType.Miden,
        midenSourceAccount: params.midenAccountId,
        createMidenP2IDNote,
      });
      setIntentResult(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit direct intent';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sdk]);

  const clearQuote = useCallback(() => {
    setPendingQuote(null);
    setError(null);
  }, []);

  return {
    fetchQuote,
    confirmIntent,
    submitDirectIntent,
    clearQuote,
    pendingQuote,
    intentResult,
    isLoading,
    isFetchingQuote,
    error,
    isSDKReady: !!sdk,
  };
}
