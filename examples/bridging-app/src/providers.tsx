import { type ReactNode } from "react";
import { MidenProvider } from "@miden-sdk/react";
import { MidenFiSignerProvider } from "@miden-sdk/miden-wallet-adapter-react";
import {
  AllowedPrivateData,
  WalletAdapterNetwork,
} from "@miden-sdk/miden-wallet-adapter-base";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Toaster } from "sonner";
import { APP_NAME, MIDEN_RPC_URL, MIDEN_PROVER } from "@/config";
import { wagmiConfig } from "@/config/wagmi";

// Provider chain for the bridging-app:
//
//   WagmiProvider -> QueryClientProvider -> RainbowKitProvider
//     -> MidenFiSignerProvider -> MidenProvider -> children
//
// Notes:
// - MidenFiSignerProvider must wrap MidenProvider (the React SDK reads from
//   SignerContext during init to wire its external-keystore client).
// - WagmiProvider must be outermost: RainbowKitProvider and the EVM-side
//   hooks (useAccount/useWalletClient) read from it.
// - QueryClientProvider is wagmi's transport peer dep.
// - The Toaster is mounted alongside the children so all panels can fire
//   `toast.*` notifications.

const queryClient = new QueryClient();

const rkTheme = lightTheme({
  accentColor: "#ff5c00",
  accentColorForeground: "#ffffff",
  borderRadius: "medium",
  fontStack: "system",
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme}>
          <MidenFiSignerProvider
            appName={APP_NAME}
            network={WalletAdapterNetwork.Testnet}
            allowedPrivateData={AllowedPrivateData.Assets}
            autoConnect
          >
            <MidenProvider
              config={{ rpcUrl: MIDEN_RPC_URL, prover: MIDEN_PROVER }}
              loadingComponent={
                <div className="loading">Loading Miden WASM...</div>
              }
            >
              {children}
              <Toaster position="bottom-right" closeButton duration={5_000} />
            </MidenProvider>
          </MidenFiSignerProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
