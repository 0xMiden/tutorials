import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletClient } from 'wagmi';
import type { IntentTransactionStatus } from '@epoch-protocol/epoch-intents-sdk/dist/types';

const POLL_INTERVAL = 5000;
const LOG = '[useIntentTransactionStatus]';

const TERMINAL_STATUSES = new Set(['success', 'completed', 'failed', 'reverted']);

function isTerminal(statuses: IntentTransactionStatus[]): boolean {
  if (statuses.length === 0) return false;
  return statuses.every((s) => TERMINAL_STATUSES.has(String(s.status).toLowerCase()));
}

export function useIntentTransactionStatus(userAddress?: string, intentNonce?: string) {
  const [statuses, setStatuses] = useState<IntentTransactionStatus[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdk, setSdk] = useState<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const { data: walletClient } = useWalletClient();

  useEffect(() => {
    console.log(`${LOG} walletClient changed:`, !!walletClient);
    if (!walletClient) {
      setSdk(null);
      return;
    }
    let cancelled = false;
    const apiBaseUrl = import.meta.env.VITE_ALLOCATOR_URL || 'http://localhost:3000';
    console.log(`${LOG} loading SDK, apiBaseUrl=${apiBaseUrl}`);
    import('@epoch-protocol/epoch-intents-sdk')
      .then(({ EpochIntentSDK }) => {
        if (cancelled) {
          console.log(`${LOG} SDK load cancelled`);
          return;
        }
        const instance = new EpochIntentSDK({ apiBaseUrl, walletClient: walletClient as any });
        console.log(`${LOG} SDK ready`);
        setSdk(instance);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`${LOG} SDK load failed:`, err);
        setSdk(null);
      });
    return () => {
      cancelled = true;
    };
  }, [walletClient]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      console.log(`${LOG} stopPolling — clearing interval`);
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const poll = useCallback(async () => {
    if (!sdk || !userAddress || !intentNonce) {
      console.log(`${LOG} poll skipped`, {
        hasSdk: !!sdk,
        userAddress,
        intentNonce,
      });
      return;
    }
    pollCountRef.current += 1;
    const attempt = pollCountRef.current;
    console.log(`${LOG} poll #${attempt} → getIntentStatus(${userAddress}, ${intentNonce})`);
    try {
      const result: IntentTransactionStatus[] = await sdk.getIntentStatus(userAddress, intentNonce);
      const arr = Array.isArray(result) ? result : [];
      console.log(`${LOG} poll #${attempt} result:`, arr);
      setStatuses(arr);
      setError(null);
      if (isTerminal(arr)) {
        console.log(`${LOG} terminal status reached — stop polling`);
        stopPolling();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch intent status';
      console.error(`${LOG} poll #${attempt} error:`, err);
      setError(msg);
    }
  }, [sdk, userAddress, intentNonce, stopPolling]);

  useEffect(() => {
    console.log(`${LOG} polling effect`, {
      hasSdk: !!sdk,
      userAddress,
      intentNonce,
    });
    if (!sdk || !userAddress || !intentNonce) {
      stopPolling();
      setStatuses([]);
      return;
    }
    setIsPolling(true);
    pollCountRef.current = 0;
    console.log(`${LOG} starting polling loop @ ${POLL_INTERVAL}ms`);
    void poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => stopPolling();
  }, [sdk, userAddress, intentNonce, poll, stopPolling]);

  return { statuses, isPolling, error, refetch: poll };
}
