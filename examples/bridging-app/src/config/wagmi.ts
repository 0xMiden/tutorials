import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'viem/chains';

// WalletConnect Cloud project id (https://cloud.walletconnect.com/), supplied
// via `.env`: VITE_RAINBOWKIT_PROJECT_ID=<your-project-id>. This module must
// NOT throw at import time — an import-time throw escapes React and renders a
// blank page. When the id is missing, `main.tsx` shows a setup screen instead.
const projectId = import.meta.env.VITE_RAINBOWKIT_PROJECT_ID;

/** False when VITE_RAINBOWKIT_PROJECT_ID is unset — main.tsx renders a setup screen. */
export const hasRainbowKitProjectId = Boolean(projectId);

// Only real EVM chains belong in the wagmi config — Miden has no wagmi-compatible
// chain id and is handled via the Miden SDK + wallet adapter, not via wagmi.
export const chains = [sepolia] as const;

export const wagmiConfig = getDefaultConfig({
  appName: 'Miden x Epoch Bridge',
  // getDefaultConfig requires a non-empty projectId to build the config; the
  // placeholder lets the app boot far enough for main.tsx to render the setup
  // error rather than crashing before first paint.
  projectId: projectId || 'rainbowkit-project-id-not-set',
  chains,
});
