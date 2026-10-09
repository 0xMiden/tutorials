# Bridging app — Sepolia ↔ Miden via Epoch

```bash
yarn create miden-app bridging-app
cd bridging-app
yarn install
```

Run the reference app:

```bash
git clone https://github.com/0xMiden/tutorials.git
cd tutorials/examples/bridging-app
yarn install
yarn dev
```

Open [http://localhost:5173](http://localhost:5173). The app exposes two tabs — `Bridge to EVM` (Miden → Sepolia) and `Withdraw to Miden` (Sepolia → Miden). It defaults to Miden **testnet**. A live round trip requires an Epoch allocator and asset faucet deployed on that same network, plus both wallets.

## Environment

Copy `.env.example` to `.env` and supply the required values:

| Variable                     | Required     | Description                                                                                                       |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `VITE_RAINBOWKIT_PROJECT_ID` | yes          | WalletConnect Cloud project id from <https://cloud.walletconnect.com/>.                                           |
| `VITE_ALLOCATOR_URL`         | yes          | An Epoch allocator compatible with v0.17 on the selected Miden network.                                           |
| `VITE_MIDEN_NETWORK`         | no           | `testnet` (default), `devnet`, or `local`; selects the wallet network and RPC/prover defaults.                    |
| `VITE_MIDEN_RPC_URL`         | no           | Override Miden RPC; must match the selected wallet network.                                                       |
| `VITE_MIDEN_PROVER`          | no           | Override the prover; `local` uses local proving.                                                                  |
| `VITE_MIDEN_USDC_FAUCET_ID`  | yes for USDC | Allocator-approved faucet on the selected network. If unset, enter it manually in the form; no old ID is assumed. |
| `VITE_MIDENSCAN_URL`         | no           | Override block-explorer base; defaults to the selected network's Midenscan.                                       |

For explicit devnet checks, set `VITE_MIDEN_NETWORK`, `VITE_MIDEN_RPC_URL`, and
`VITE_MIDEN_PROVER` to `devnet` and use a matching allocator and faucet.

## Prerequisites

- An EVM wallet supported by [RainbowKit](https://www.rainbowkit.com/) (MetaMask, Rabby, Coinbase Wallet, …).
- The [MidenFi browser extension](https://chromewebstore.google.com/detail/miden-wallet/ablmompanofnodfdkgchkpmphailefpb) to sign the P2IDE note on Miden.
- Native MIDEN tokens in the Miden wallet to pay transaction fees.
- A small Sepolia ETH balance for gas; grab some from the [pk910 PoW faucet](https://sepolia-faucet.pk910.de/) or the [Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).

## Scripts

```bash
yarn dev            # Vite dev server (http://localhost:5173)
yarn build          # tsc -b && vite build
yarn preview        # Serve the production build locally
yarn test           # Vitest
yarn lint           # ESLint
```

## Tutorial

The accompanying single-page tutorial lives at
[`docs/src/web-client/bridging_with_epoch_tutorial.md`](../../docs/src/web-client/bridging_with_epoch_tutorial.md).
Every fenced code block in the tutorial is byte-identical to a slice of this
app's source, called out by a preceding
`<!-- source: examples/bridging-app/<file>:<line range> -->` comment.

## Forked from

`epochprotocol/miden-integration-example@efc3a690` with the following bridging-specific adaptations:

- `'1000'` reclaim-height literal replaced with `String(currentMidenBlock + 1000)` computed at the call site (`IntentForm.tsx`).
- Dead `defineChain({ id: 0 })` Miden placeholder and the no-op `midenClient` removed from `src/config/wagmi.ts`.
- RainbowKit `projectId` is env-driven via `VITE_RAINBOWKIT_PROJECT_ID`; a missing value renders a setup screen instead of crashing to a blank page.
- `WithdrawForm` `SEPOLIA_TOKENS` decimals corrected to `18` for USDC/USDT — the Epoch test ERC-20s are 18-decimal on Sepolia, matching the same addresses in `IntentForm` (the upstream reference had them as `6`).
- The general-purpose Miden wallet UI (`BalancePanel`, `NotesInboxPanel`, `TransferPanel`, `MidenStatus`, `PersistenceControls`, `BalanceAccountRow`, `AllocatorDebugPanel`) is omitted to keep the example focused on bridging.
