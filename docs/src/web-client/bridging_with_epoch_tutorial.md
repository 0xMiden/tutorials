---
title: 'Bridging Miden to and from EVM with Epoch'
sidebar_position: 9
---

# Bridging Miden to and from EVM with Epoch

_Move assets between Miden and Sepolia testnet through the Epoch protocol intent SDK, without writing a custom bridge_

## Overview

This is a guided tour of the runnable reference app under [`examples/bridging-app/`](https://github.com/0xMiden/tutorials/tree/main/examples/bridging-app), which bridges fungible tokens between Miden and an EVM chain (Sepolia testnet) in both directions through the [Epoch protocol](https://epochprotocol.xyz/) intent SDK. Clone and run the app, then read the steps below as annotations on the integration points you'd port into your own Miden frontend. Every fenced code block is a verbatim slice of the app; the file and line range above each block points to the source.

> **When to use Epoch vs Agglayer.** This tutorial uses **Epoch** because it is the only Miden bridge with a working TypeScript SDK, EVM-wallet integration, and broad chain coverage today — Epoch's Compact contract is deployed on Ethereum, Polygon, Optimism, Arbitrum, Base (mainnet) and on Sepolia plus six other EVM testnets. If your app is **authored in Rust/MASM, needs Polygon CDK ecosystem compatibility, or settles on a Polygon Agglayer-connected rollup**, the Agglayer protocol surface ships in-tree at [`protocol/crates/miden-agglayer/SPEC.md`](https://github.com/0xMiden/protocol/blob/next/crates/miden-agglayer/SPEC.md); Miden testnet ↔ Sepolia bridging via Agglayer went live on 2026-04-24.

Stack: Vite + React 19 + TypeScript, `@miden-sdk/react`, `@epoch-protocol/epoch-intents-sdk`, [RainbowKit](https://www.rainbowkit.com/) + [wagmi](https://wagmi.sh/) + [viem](https://viem.sh/).

## What we'll cover

- Wire the Epoch SDK against a wagmi `walletClient`, including the chain-id override for Miden-source intents.
- Build a Miden → EVM bridge: reverse-quote, sign a P2IDE note via the MidenFi wallet adapter, submit the intent, and poll for settlement.
- Build the reverse EVM → Miden bridge: deposit an ERC-20 into Epoch's Compact contract and receive a P2ID note on Miden.
- A `EpochIntentSDK` API reference card with all 11 public methods.
- Inline pitfalls — the eleven traps every Epoch integration hits before the first successful round-trip.

## Prerequisites

You need three things to follow along.

1. The reference app, cloned from this repo. The bridging-specific layer (Epoch SDK wiring, wagmi/RainbowKit + viem, intent forms, status panels) lives in `examples/bridging-app/`; `yarn create miden-app` (≥ 1.0.7) is the Miden + Vite + WASM scaffold it started from. Clone the repo, `cd examples/bridging-app`, then `cp .env.example .env` inside that directory and fill in: `VITE_RAINBOWKIT_PROJECT_ID` (a [WalletConnect Cloud](https://cloud.walletconnect.com/) project id — required), `VITE_ALLOCATOR_URL` (default `https://testnet-dev.epochprotocol.xyz`), `VITE_MIDEN_RPC_URL` (default `testnet`), `VITE_MIDEN_PROVER` (default `testnet`), and the optional `VITE_MIDENSCAN_URL`. See the [setup guide](./setup_guide.md) if this is your first Miden frontend.

2. Two wallets: an EVM wallet supported by [RainbowKit](https://www.rainbowkit.com/) (MetaMask, Rabby, Coinbase Wallet, …) and the [MidenFi browser extension](https://chromewebstore.google.com/detail/miden-wallet/ablmompanofnodfdkgchkpmphailefpb) for signing P2IDE notes on Miden.

3. A small Sepolia ETH balance for gas. The community [pk910 PoW faucet](https://sepolia-faucet.pk910.de/) pays 0.05–0.1 ETH per ~10-minute mining session; the [Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) is the backup. Either covers the gas for `depositERC20AndRegister` plus a couple of allowance approvals.

:::caution Do not set COOP/COEP headers
`@miden-sdk/vite-plugin` defaults to `crossOriginIsolation: true`, which sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers on the dev server and breaks gRPC-Web to `transport.miden.io`. The reference app passes `{ crossOriginIsolation: false }` to opt out — see the [Vite + WASM setup guide](./setup_guide.md) for the deployment-side counterpart.
:::

## The Reference App

Clone, install, and boot Vite:

**From `examples/bridging-app/README.md` (lines 12–15):**

<!-- source: examples/bridging-app/README.md:12-15 -->

```bash
git clone https://github.com/0xMiden/tutorials.git
cd tutorials/examples/bridging-app
yarn install
yarn dev
```

The dev server listens on `http://localhost:5173`. You'll see two tabs — `Bridge to EVM` (Miden → Sepolia) and `Withdraw to Miden` (Sepolia → Miden) — and a wallet-connect strip that gates both forms on the EVM and Miden wallets being connected. The example app is forked from [`epochprotocol/miden-integration-example@efc3a690`](https://github.com/epochprotocol/miden-integration-example) with the bridging-specific adaptations described under "Forked from" in the app's README.

## Step 1: Wire the Epoch SDK

`EpochIntentSDK` is the single entry point for the protocol — quoting, intent submission, status, and recovery all live behind it. The reference app lazy-imports the SDK inside a `useEffect` so the React 19 StrictMode double-mount does not initialise it twice, and it overrides `walletClient.chain.id` to `999999999`, the synthetic Miden chain id Epoch's allocator keys Miden lookups by. The EVM-side `walletClient` is otherwise spread through verbatim — wagmi already wired the chain, transport, and signer when the user connected via RainbowKit.

The snippet below sits inside the `useEpochIntent` hook — `walletClient` is `useWalletClient().data` from wagmi, and `setSdk` is the hook's own `useState` setter.

**From `examples/bridging-app/src/hooks/useEpochIntent.ts` (lines 22–43):**

<!-- source: examples/bridging-app/src/hooks/useEpochIntent.ts:22-43 -->

```typescript
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
```

:::caution Do not follow the package README
The npm package ships a `# Compact SDK` README that documents a different SDK and a different surface. Treat `EpochIntentSDK`'s exported method names from `dist/index.d.ts` as the source of truth — the [API Reference Card](#api-reference-card) below lists them.
:::

The `useWithdrawIntent` hook keeps `walletClient.chain.id` untouched — the EVM → Miden direction uses the real Sepolia chain id (`11155111`).

## Step 2: Miden → EVM bridge

A Miden → EVM bridge runs four stages: `getTaskData` (the allocator computes a quote envelope), `getIntentQuote` (price discovery), `solveIntent` (the user signs a P2IDE note on Miden via the wallet adapter callback), and a 5-second polling loop against `getIntentStatus` until the solver lands the EVM transfer. The reference app's `buildEpochTaskDataParams` produces the envelope and computes `midenReclaimHeight` at the call site so it stays relative to the current Miden chain tip (Pitfalls row 4 has the technical reason).

**From `examples/bridging-app/src/services/epoch-bridge.ts` (lines 141–173):**

<!-- source: examples/bridging-app/src/services/epoch-bridge.ts:141-173 -->

```typescript
  // Reclaim height must come from the call site as `currentMidenBlock + N`.
  // A literal default (e.g. '1000') would be evaluated against an unspecified
  // chain tip and become unsafe if the user's note ages before the intent is
  // solved — see pitfall §1.7 row 4.
  if (params.midenReclaimHeight == null) {
    throw new Error(
      'midenReclaimHeight is required; pass String(currentMidenBlock + N) computed at the call site.',
    );
  }

  const taskDataParams = {
    taskType: 'gettokenout' as TaskType,
    intentData: {
      // isNative must be false — tokenIn is zero-address (Miden-sourced) but tokenOut is a real EVM token
      isNative: false,
      depositTokenAddress: ZERO_ADDRESS,
      tokenInAmount: amountInSmallestUnit,
      outputTokenAddress: outputToken,
      minTokenOut: scaledMinTokenOut,
      destinationChainId: String(params.destinationChainId),
      protocolHashIdentifier: ZERO_HASH,
      recipient: params.evmRecipient,
    },
    // Mirror EpochSwapWidget Miden extraData pattern exactly
    extraDataTypestring: 'string midenSourceAccount,string midenFaucetId,string midenNoteType,string midenNoteId,uint256 midenReclaimHeight',
    extraData: {
      midenSourceAccount: midenSourceAccountHex,
      midenFaucetId: midenFaucetIdHex,
      midenNoteType: 'P2IDE',
      midenNoteId: '',
      midenReclaimHeight: String(params.midenReclaimHeight),
    },
  };
```

Once the quote returns and the user clicks **Confirm & sign**, the `createMidenP2IDNote` callback fires. The reference app's callback uses `useMidenFiWallet().requestSend` to construct an explicitly `'public'` P2IDE `SendTransaction`, guards the amount under `Number.MAX_SAFE_INTEGER` (the wallet adapter's `SendTransaction` constructor takes a `number`, not a `bigint`), and awaits a 120-second `waitForTransaction(txId, 120_000)` to read the output note id.

**From `examples/bridging-app/src/components/crosschain/IntentForm.tsx` (lines 200–243):**

<!-- source: examples/bridging-app/src/components/crosschain/IntentForm.tsx:200-243 -->

```typescript
    const createMidenP2IDNote: SolveIntentParams['createMidenP2IDNote'] = async (
      faucetIdParam,
      amountParam,
      allocatorId,
    ) => {
      setConfirmStatus('Resource lock required — creating P2IDE note on Miden…');
      try {
        if (!midenAccountId) {
          throw new Error('Missing Miden account id');
        }
        if (!requestSend) {
          throw new Error('Miden wallet adapter is not connected');
        }

        const normalizedAmount = BigInt(amountParam);
        if (normalizedAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Amount too large for wallet adapter send');
        }

        const payload = new SendTransaction(
          midenAccountId,
          allocatorId,
          faucetIdParam,
          'public',
          Number(normalizedAmount),
        );
        const txId = await requestSend(payload);

        // Prefer adapter waitForTransaction to get the output note id.
        if (!waitForTransaction) {
          throw new Error('Miden wallet adapter is missing waitForTransaction');
        }
        const finalized = await waitForTransaction(txId, 120_000);
        const first = finalized.outputNotes?.[0];
        const noteId = first ? first.id().toString() : '';
        if (!noteId) {
          throw new Error(`Could not read output note id for tx ${txId}`);
        }
        setLocalMidenNoteId(noteId);
        return { success: true, noteId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    };
```

Success is signalled by the 5-second polling loop: `getIntentStatus` returns an `IntentTransactionStatus[]`, which the app reduces into the composite `IntentFlowStatus`. The forward bridge is settled once the destination chain reports a terminal-OK row (`evmCompleted`) and the synthetic Miden row carries a terminal `midenStatus` — the EVM transfer landed and the allocator consumed the P2IDE note. That reducer is destination-chain aware: it filters status rows to the chain the user selected, never reports completion while any destination-chain row is still `pending`, and takes the last destination-chain success — so an intermediate allocator/Compact row is never mistaken for the final settlement. The Pitfalls section below catalogues the gotchas this step inherits (public note type, awaiting `waitForTransaction`, advisory `midenFaucetDecimals`, the `Number.MAX_SAFE_INTEGER` guard).

## Step 3: EVM → Miden bridge

The reverse direction lives in `buildEVMToMidenTaskDataParams` + `useWithdrawIntent`. The task envelope sets `destinationChainId` to the Miden virtual chain id (`999999999`) so the allocator's `getTokenDataFromMidenFaucetId` resolves the output side as Miden-native, and the note type flips to `P2ID` (not `P2IDE`) because the Miden recipient consumes the note directly rather than recalling it. The reverse-quote convention is the same as Step 2: pass `tokenInAmount: '0'` and a Miden-side `minTokenOut` in base units; the backend computes the required EVM input.

:::caution Bridge with headroom before the reverse direction
The Step 3 reverse quote folds a route fee into the required deposit, so a Step 2 bridge of exactly 1 USDC won't cover a 1-USDC reverse — the quote asks for ~1.01 USDC and MetaMask flags `depositERC20AndRegister` as likely to fail (the `approve` lands first; rejecting the deposit is recoverable). Set Step 2's `min output` to about `2e18` for headroom, or run a second forward bridge before retrying.
:::

**From `examples/bridging-app/src/services/epoch-bridge.ts` (lines 224–245):**

<!-- source: examples/bridging-app/src/services/epoch-bridge.ts:224-245 -->

```typescript
  const taskDataParams = {
    taskType: 'gettokenout' as TaskType,
    intentData: {
      isNative: false,
      depositTokenAddress: params.evmTokenAddress,
      tokenInAmount: amountInWei,
      outputTokenAddress: ZERO_ADDRESS,
      minTokenOut: scaledMinMidenOut, // Miden-side minimum out (base units)
      destinationChainId: String(destinationChainId),
      protocolHashIdentifier: ZERO_HASH,
      recipient: params.evmSourceAddress,
    },
    extraDataTypestring: 'string midenRecipientAccount,string midenFaucetId,string midenNoteType',
    extraData: {
      midenRecipientAccount: midenRecipientHex,
      midenFaucetId: midenFaucetHex,
      midenNoteType: 'P2ID',
    },
  };

  console.log('[EpochBridge] EVM→Miden task data params built:', taskDataParams);
  return taskDataParams;
```

`solveIntent({ ..., collateralType: CollateralType.EVM })` then walks the user's wallet through an ERC-20 `approve` (only on the first deposit of a given token) and `depositERC20AndRegister` / `depositNativeAndRegister` against Epoch's [Compact](https://docs.epochprotocol.xyz/epoch-miden-integration/integration-guide) contract on Sepolia. The intent nonce extracted from the solve result drives the same 5-second status poll as the forward direction.

:::caution Forced-withdrawal preflight
If the user cancelled a prior EVM → Miden intent on the same Compact deposit id, the next intent will revert. Call `sdk.disableForcedWithdrawal({ ... })` first; the SDK error message names the deposit id when this preflight is required.
:::

:::caution The Withdraw token is Epoch's test ERC-20, not Circle's USDC
The "USDC" the Withdraw form lists is Epoch's test token (`0x2BB4FfD7…`), not Circle's canonical Sepolia USDC, and it has no public faucet. Run **Step 2 (Miden → EVM) first** — it delivers Epoch test USDC to your EVM wallet — then bridge it back. Bridge out before you bridge back.
:::

## Step 4: The bridged P2ID note is consumed by your wallet

Step 3's allocator delivers its output as a **P2ID note** addressed to your Miden account, not as a vault credit. In Miden's actor model, a note must be _consumed_ in a transaction before it becomes spendable balance. The Miden Wallet consumes incoming P2ID notes when it detects them, so the bridged funds appear as wallet balance within seconds and are immediately usable as the source for another Miden → EVM bridge. The reference app's `WithdrawConsume` component keeps this step informational: it shows the delivered note ID and links to Midenscan so you can confirm settlement.

## API Reference Card

Most apps only touch four methods (`getTaskData`, `getIntentQuote`, `solveIntent`, `getIntentStatus`); the rest cover recovery and read-only queries. Sources cite `dist/index.d.ts` from `@epoch-protocol/epoch-intents-sdk@1.0.23`.

| Method                      | Signature (abridged)                                                     | Use it to                                                              | Source               |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------- |
| `getTaskData`               | `(params: GetTaskDataParams) => Promise<{ taskTypeString, intentData }>` | Construct the SIO envelope before quoting                              | `dist/index.d.ts:11` |
| `solveIntent`               | `(params: SolveIntentParams) => Promise<SolveIntentResult>`              | Submit the intent + run the optional Miden P2ID note callback          | `dist/index.d.ts:12` |
| `getIntentQuote`            | `(params: GetIntentQuoteParams) => Promise<IntentQuoteResult>`           | Reverse-quote (`tokenInAmount: '0'`) or forward quote                  | `dist/index.d.ts:13` |
| `retryIntentSolve`          | `(id: string) => Promise<TransactionResult>`                             | Re-run the solver if a transient failure is observed                   | `dist/index.d.ts:14` |
| `initateDepositWithdrawal`  | `(id: string) => Promise<TransactionResult>`                             | Initiate a forced withdrawal flow (verbatim misspelling; see Pitfalls) | `dist/index.d.ts:16` |
| `disableForcedWithdrawal`   | `(params: DisableForcedWithdrawalParams) => Promise<TransactionResult>`  | Cancel a pending forced withdrawal so a new intent can solve           | `dist/index.d.ts:17` |
| `withdrawToken`             | `(params: WithdrawTokenParams) => Promise<TransactionResult>`            | Reclaim an unfulfilled EVM-side deposit                                | `dist/index.d.ts:18` |
| `getForcedWithdrawalStatus` | `(id: string) => Promise<ForcedWithdrawalStatus>`                        | Observe a forced-withdrawal lifecycle                                  | `dist/index.d.ts:19` |
| `getDepositedBalances`      | `(addr: string) => Promise<DepositedBalance[]>`                          | List the user's locked balances in the Compact                         | `dist/index.d.ts:20` |
| `getIntentStatus`           | `(addr: string, nonce: string) => Promise<IntentTransactionStatus[]>`    | Drive the 5s polling loop                                              | `dist/index.d.ts:21` |
| `getHealthCheck`            | `() => Promise<HealthCheckResult>`                                       | Probe allocator availability before quoting                            | `dist/index.d.ts:22` |

Recovery primitives (`retryIntentSolve`, `disableForcedWithdrawal`, `withdrawToken`, `initateDepositWithdrawal`) are the difference between an intent flow that "mostly works" and one that lets users recover from solver outages or network failures.

## Pitfalls

Eleven traps every Epoch integration hits before the first successful round-trip. The reference app ships mitigations for each.

- **Don't follow the npm package README.** It documents an unrelated SDK; the [integration guide](https://docs.epochprotocol.xyz/epoch-miden-integration/integration-guide) and `dist/index.d.ts` are the source of truth.
- **Public notes only.** P2IDE notes for the allocator must be `'public'`; a `'private'` note is invisible to the solver.
- **Always await `waitForTransaction`.** Reading `outputNotes[0]` early returns an empty array; the 120-second timeout covers proving + testnet submission.
- **Reclaim height is `currentBlock + N`.** `midenReclaimHeight` is absolute; use `useSyncState().syncHeight + 1000` at the call site, never a literal.
- **`minTokenOut` is base units.** The reverse-quote path passes it straight through — no `parseUnits`. For an 18-decimal token, `"1000000000000000000"` is one whole unit.
- **Override `walletClient.chain.id` for Miden-source intents.** Set `chain.id = 999999999` for Miden → EVM only; leave it as the real EVM chain id for the reverse direction.
- **`midenFaucetDecimals` is advisory.** Fall back to UI-selected decimals when the allocator value would change the displayed amount by an order of magnitude.
- **`Number.MAX_SAFE_INTEGER` guard.** The wallet adapter's `SendTransaction` constructor takes a `number`; guard the amount before casting.
- **No COOP/COEP on the dev server.** `midenVitePlugin({ crossOriginIsolation: false })` is mandatory — the default breaks gRPC-Web to `transport.miden.io`.
- **Forced-withdrawal preflight.** Call `sdk.disableForcedWithdrawal` before re-running an EVM → Miden intent on a deposit id the user cancelled previously.
- **`initateDepositWithdrawal` (misspelling).** The SDK exports the method with the typo — use it verbatim, do not silently rename.

## Where to go next

- The runnable [`examples/bridging-app/`](https://github.com/0xMiden/tutorials/tree/main/examples/bridging-app) is the canonical reference; every code block above is a paste-verified slice of it.
- The [Epoch protocol integration guide](https://docs.epochprotocol.xyz/epoch-miden-integration/integration-guide) covers the SDK surface in depth, including the parts this tutorial does not exercise (multi-hop intents, custom resource locks).
- Upstream Epoch example: [`epochprotocol/miden-integration-example`](https://github.com/epochprotocol/miden-integration-example). The reference app forks this with the adaptations documented in its README.
- The companion [React wallet tutorial](./react_wallet_tutorial.md) walks the `@miden-sdk/react` hook surface end-to-end if you want a deeper foundation before extending the bridging app.
