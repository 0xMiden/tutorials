/**
 * Shared MidenWalletAdapter context.
 *
 * `useMidenWalletAdapter` fires `requestAssets()` (a Miden Wallet confirmation
 * popup) inside an effect on mount. This provider hoists the hook to a single
 * call site and exposes the result via context so every consumer reads the same
 * instance and only one popup opens.
 */

import { createContext, useContext, type ReactNode } from 'react';
import {
  useMidenWalletAdapter,
  type UseMidenWalletAdapterResult,
} from './useMidenWalletAdapter';

const MidenWalletAdapterContext = createContext<UseMidenWalletAdapterResult | null>(null);

interface Props {
  /** Mirrors the hook's `enabled` option. Defaults to true. */
  enabled?: boolean;
  children: ReactNode;
}

export function MidenWalletAdapterProvider({ enabled = true, children }: Props) {
  const value = useMidenWalletAdapter({ enabled });
  return (
    <MidenWalletAdapterContext.Provider value={value}>
      {children}
    </MidenWalletAdapterContext.Provider>
  );
}

export function useMidenWalletAdapterContext(): UseMidenWalletAdapterResult {
  const ctx = useContext(MidenWalletAdapterContext);
  if (!ctx) {
    throw new Error(
      'useMidenWalletAdapterContext must be used inside <MidenWalletAdapterProvider>',
    );
  }
  return ctx;
}
