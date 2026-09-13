---
title: 'Building a React Wallet'
sidebar_position: 8
---

# Building a React Wallet

_Using the Miden React SDK to build a complete wallet UI with account management, token transfers, and note claiming_

## Overview

In this tutorial we will build a complete wallet application using the `@miden-sdk/react` package. The Miden React SDK provides a set of hooks and utilities that make it easy to integrate Miden functionality into React applications.

By the end of this tutorial, you will have a working wallet that can:

- Create new accounts
- Display account balances
- List and claim unclaimed notes
- Send tokens to other accounts

## What we'll cover

- Setting up a React project with the Miden React SDK
- Using the `MidenProvider` to configure the client
- Managing accounts with `useAccounts`, `useAccount`, and `useCreateWallet`
- Displaying and claiming notes with `useNotes` and `useConsume`
- Sending tokens with `useSend`
- Formatting utilities for assets and notes
- External signer integration patterns

## Prerequisites

- Node `v20` or greater
- Familiarity with React and TypeScript
- `yarn`

:::note v0.16 testnet and fees

A new wallet needs native fee tokens before sending assets. Request and claim a
funding note from the testnet faucet, as described in the
[fee setup](./setup_guide.md#network-and-fee-setup). Claim the returned
note ID and wait for confirmation before sending.

Select testnet in both the client and any external wallet adapter.

:::

---

## Step 1: Project Setup and MidenProvider

First, create a new Vite + React project and install the Miden React SDK.

1. Create a new Vite project with React and TypeScript:

   ```bash
   npx create-vite@latest miden-wallet --template react-ts
   cd miden-wallet
   ```

2. Install the Miden React SDK:

   ```bash
   yarn add @miden-sdk/miden-sdk@0.16.0 @miden-sdk/react@0.16.0
   ```

3. Install the Vite integration and update `vite.config.ts`. The Miden plugin v0.16 supports Vite 5 and 6, so pin Vite 6 and its compatible React plugin even if the generator installed newer versions:

   ```bash
   yarn add -D vite@^6 @vitejs/plugin-react@^4 @miden-sdk/vite-plugin@0.16.0 vite-plugin-wasm vite-plugin-top-level-await
   ```

   ```ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import { midenVitePlugin } from '@miden-sdk/vite-plugin';
   import wasm from 'vite-plugin-wasm';
   import topLevelAwait from 'vite-plugin-top-level-await';

   export default defineConfig({
     plugins: [react(), midenVitePlugin({ crossOriginIsolation: false }), wasm(), topLevelAwait()],
     worker: { format: 'es', plugins: () => [wasm(), topLevelAwait()] },
   });
   ```

   This Vite tutorial uses the main SDK entries throughout. Para and Turnkey import
   `SignerContext` from `@miden-sdk/react`; mixing it with `/lazy` creates separate
   contexts in v0.16. Keep providers and hooks on the same entry.

4. Configure the `MidenProvider` in your `main.tsx` file. The provider initializes the Miden client and makes it available to all child components:

```tsx
// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MidenProvider } from '@miden-sdk/react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MidenProvider
      config={{
        rpcUrl: 'testnet',
        prover: 'local',
      }}
    >
      <App />
    </MidenProvider>
  </React.StrictMode>,
);
```

The `MidenProvider` accepts a `config` object with the following options:

- `rpcUrl`: The RPC endpoint to connect to (`"testnet"`, `"devnet"`, or a custom URL)
- `prover`: The prover to use (`"testnet"` for testnet delegated proving, or `"local"` for local proving)

---

## Step 2: App Shell with useMiden

The `useMiden()` hook provides access to the client's initialization state. Use it to show loading and error states while the client initializes.

```tsx
// App.tsx
import { useMiden } from '@miden-sdk/react';

export default function App() {
  const { isReady, error } = useMiden();

  if (error) return <div>Error: {error.message}</div>;
  if (!isReady) return <div>Initializing...</div>;

  return <div>Wallet ready!</div>;
}
```

The `useMiden()` hook returns:

- `isReady`: `true` when the client has finished initializing
- `error`: An error object if initialization failed

---

## Step 3: Listing Accounts with useAccounts

The `useAccounts()` hook provides access to all accounts stored in the client. Use it to check if the user has any existing wallets.

```tsx
import { useMiden, useAccounts } from '@miden-sdk/react';

export default function App() {
  const { isReady, error } = useMiden();
  const { wallets, isLoading } = useAccounts();

  if (error) return <div>Error: {error.message}</div>;
  if (!isReady || isLoading) return <div>Loading...</div>;

  const accountId = wallets[0]?.id().toString();

  if (!accountId) {
    return <div>No wallet found. Create one!</div>;
  }

  return <div>Account: {accountId}</div>;
}
```

The `useAccounts()` hook returns:

- `wallets`: Array of wallet accounts
- `faucets`: Array of faucet accounts
- `isLoading`: `true` while accounts are being fetched

---

## Step 4: Creating a Wallet with useCreateWallet

The `useCreateWallet()` hook provides a function to create new wallet accounts.

```tsx
import { useMiden, useAccounts, useCreateWallet } from '@miden-sdk/react';
import { getWasmOrThrow } from '@miden-sdk/miden-sdk';

export default function App() {
  const { isReady, error } = useMiden();
  const { wallets, isLoading } = useAccounts();
  const { createWallet, isCreating } = useCreateWallet();

  if (error) return <div>Error: {error.message}</div>;
  if (!isReady || isLoading) return <div>Loading...</div>;

  const accountId = wallets[0]?.id().toString();

  if (!accountId) {
    return (
      <div>
        <h1>Wallet</h1>
        <button
          onClick={async () => createWallet({
            authScheme: (await getWasmOrThrow()).AuthScheme.AuthRpoFalcon512,
          })}
          disabled={isCreating}
        >
          {isCreating ? 'Creating...' : 'Create wallet'}
        </button>
      </div>
    );
  }

  return <Wallet accountId={accountId} />;
}

function Wallet({ accountId }: { accountId: string }) {
  return <div>Wallet: {accountId}</div>;
}
```

Pass the low-level Falcon enum explicitly with the pinned lazy React SDK. The
high-level client's authentication enum is not interchangeable with the numeric
enum expected by this hook.

The `useCreateWallet()` hook returns:

- `createWallet(options?)`: Function to create a new wallet
- `isCreating`: `true` while a wallet is being created

---

## Step 5: Displaying Account Details with useAccount

The `useAccount(accountId)` hook provides detailed information about a specific account, including its assets and balances.

```tsx
import { useAccount, formatAssetAmount } from '@miden-sdk/react';

function Wallet({ accountId }: { accountId: string }) {
  const { account, assets } = useAccount(accountId);

  return (
    <div>
      <h1>Wallet</h1>

      <div>
        <h2>Address</h2>
        <div>{account?.bech32id?.() ?? 'Loading...'}</div>
      </div>

      <div>
        <h2>Balances</h2>
        {assets.length === 0 ? (
          <div>No assets</div>
        ) : (
          <ul>
            {assets.map((asset) => (
              <li key={asset.assetId}>
                <span>{asset.symbol ?? asset.assetId}</span>
                <span>{formatAssetAmount(asset.amount, asset.decimals)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

The `useAccount(accountId)` hook returns:

- `account`: The account object with methods like `bech32id()`
- `assets`: Array of asset objects with `assetId`, `symbol`, `amount`, and `decimals`
- `isLoading`: `true` while account data is being fetched

The `formatAssetAmount(amount, decimals)` utility formats a raw amount with the correct decimal places.

---

## Step 6: Listing Unclaimed Notes with useNotes

The `useNotes({ accountId })` hook provides access to notes that can be consumed by the account.

```tsx
import { useNotes, formatNoteSummary } from '@miden-sdk/react';

function UnclaimedNotes({ accountId }: { accountId: string }) {
  const { consumableNoteSummaries } = useNotes({ accountId });

  return (
    <div>
      <h2>Unclaimed Notes</h2>
      {consumableNoteSummaries.length === 0 ? (
        <div>No unclaimed notes</div>
      ) : (
        <ul>
          {consumableNoteSummaries.map((summary) => (
            <li key={summary.id}>{formatNoteSummary(summary)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

The `useNotes({ accountId })` hook returns:

- `consumableNoteSummaries`: Array of note summaries that can be consumed
- `isLoading`: `true` while notes are being fetched

The `formatNoteSummary(summary)` utility formats a note summary for display.

---

## Step 7: Claiming Notes with useConsume

The `useConsume()` hook provides a function to consume (claim) notes and add their assets to the account.

```tsx
import { useConsume, formatNoteSummary, type NoteSummary } from '@miden-sdk/react';

function UnclaimedNotes({
  accountId,
  consumableNoteSummaries,
}: {
  accountId: string;
  consumableNoteSummaries: NoteSummary[];
}) {
  const { consume, isLoading: isConsuming } = useConsume();

  const claimNote = (id: string) => () => {
    consume({ accountId, notes: [id] });
  };

  return (
    <div>
      <h2>Unclaimed Notes</h2>
      {consumableNoteSummaries.length === 0 ? (
        <div>No unclaimed notes</div>
      ) : (
        <ul>
          {consumableNoteSummaries.map((summary) => (
            <li key={summary.id}>
              <span>{formatNoteSummary(summary)}</span>
              <button onClick={claimNote(summary.id)} disabled={isConsuming}>
                Claim
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

The `useConsume()` hook returns:

- `consume({ accountId, notes })`: Function to consume one or more notes
- `isLoading`: `true` while notes are being consumed

---

## Step 8: Sending Tokens with useSend

The `useSend()` hook provides a function to send tokens to other accounts. Select the first asset when balances arrive asynchronously, as shown below, so a newly funded wallet can use the form.

```tsx
import { useEffect, useState, type ChangeEvent } from 'react';
import { useSend, parseAssetAmount } from '@miden-sdk/react';
import { NoteVisibility } from '@miden-sdk/miden-sdk';

function SendForm({
  accountId,
  assets,
}: {
  accountId: string;
  assets: Array<{ assetId: string; symbol?: string; decimals?: number }>;
}) {
  const { send, isLoading: isSending } = useSend();
  const [to, setTo] = useState('');
  const [assetId, setAssetId] = useState('');
  const defaultAssetId = assets[0]?.assetId;

  useEffect(() => {
    if (!assetId && defaultAssetId) setAssetId(defaultAssetId);
  }, [assetId, defaultAssetId]);
  const [amount, setAmount] = useState('');
  const [noteType, setNoteType] = useState<NoteVisibility>(
    NoteVisibility.Private,
  );

  const selectedAsset = assets.find((asset) => asset.assetId === assetId);
  const selectedDecimals = selectedAsset?.decimals;
  const hasAssets = assets.length > 0;
  const canSend = Boolean(hasAssets && to && assetId && amount);

  const handleSend = async () => {
    try {
      if (!assetId) return;
      const amt = parseAssetAmount(amount, selectedDecimals);
      await send({ from: accountId, to, assetId, amount: amt, noteType });
      setAmount('');
    } catch (error) {
      console.error(error);
    }
  };

  const onAssetChange = (e: ChangeEvent<HTMLSelectElement>) =>
    setAssetId(e.target.value);
  const onNoteTypeChange = (e: ChangeEvent<HTMLSelectElement>) =>
    setNoteType(e.target.value as 'private' | 'public');
  const onToChange = (e: ChangeEvent<HTMLInputElement>) =>
    setTo(e.target.value);
  const onAmountChange = (e: ChangeEvent<HTMLInputElement>) =>
    setAmount(e.target.value);

  return (
    <div>
      <h2>Send</h2>
      <select value={noteType} onChange={onNoteTypeChange}>
        <option value="private">Private</option>
        <option value="public">Public</option>
      </select>
      <select value={assetId} onChange={onAssetChange} disabled={!hasAssets}>
        {hasAssets ? (
          assets.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.symbol ?? asset.assetId}
            </option>
          ))
        ) : (
          <option value="">No assets</option>
        )}
      </select>
      <input
        placeholder="Recipient address"
        value={to}
        onChange={onToChange}
        disabled={!hasAssets}
      />
      <input
        placeholder="Amount"
        value={amount}
        onChange={onAmountChange}
        disabled={!hasAssets}
      />
      <button disabled={!canSend || isSending} onClick={handleSend}>
        {isSending ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
}
```

The `useSend()` hook returns:

- `send({ from, to, assetId, amount, noteType })`: Function to send tokens
- `isLoading`: `true` while the transaction is being processed

Parameters:

- `from`: The sender's account ID
- `to`: The recipient's address (bech32 format)
- `assetId`: The asset/faucet ID to send
- `amount`: The amount to send (as a BigInt)
- `noteType`: Either `"private"` or `"public"`

The `parseAssetAmount(amount, decimals)` utility converts a string amount to a BigInt with the correct decimal places.

---

## Summary: Complete Code

Here is the complete wallet application combining all the features we've covered.

**main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MidenProvider } from '@miden-sdk/react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MidenProvider
      config={{
        rpcUrl: 'testnet',
        prover: 'local',
      }}
    >
      <App />
    </MidenProvider>
  </React.StrictMode>,
);
```

**App.tsx**

```tsx
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  formatAssetAmount,
  formatNoteSummary,
  parseAssetAmount,
} from '@miden-sdk/react';
import {
  useMiden,
  useAccounts,
  useAccount,
  useNotes,
  useCreateWallet,
  useConsume,
  useSend,
} from '@miden-sdk/react';
import { NoteVisibility, getWasmOrThrow } from '@miden-sdk/miden-sdk';

const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="panel">
    <div className="label">{title}</div>
    {children}
  </div>
);

export default function App() {
  const { isReady, error } = useMiden();
  const { wallets, isLoading } = useAccounts();
  const { createWallet, isCreating } = useCreateWallet();
  const handleCreate = async () => createWallet({
    authScheme: (await getWasmOrThrow()).AuthScheme.AuthRpoFalcon512,
  });
  const createLabel = isCreating ? 'Creating...' : 'Create wallet';

  if (error) return <div className="center">Error: {error.message}</div>;
  if (!isReady || isLoading)
    return (
      <div className="center">
        {!isReady ? 'Initializing...' : 'Loading...'}
      </div>
    );

  const accountId = wallets[0]?.id().toString();
  if (!accountId)
    return (
      <div className="wallet">
        <h1>Wallet</h1>
        <button onClick={handleCreate} disabled={isCreating}>
          {createLabel}
        </button>
      </div>
    );

  return <Wallet accountId={accountId} />;
}

function Wallet({ accountId }: { accountId: string }) {
  const { account, assets } = useAccount(accountId);
  const { consumableNoteSummaries } = useNotes({ accountId });
  const { consume, isLoading: isConsuming } = useConsume();
  const { send, isLoading: isSending } = useSend();
  const [to, setTo] = useState('');
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [noteType, setNoteType] = useState<NoteVisibility>(
    NoteVisibility.Private,
  );
  const defaultAssetId = assets[0]?.assetId;
  const selectedAsset = assets.find((asset) => asset.assetId === assetId);
  const selectedDecimals = selectedAsset?.decimals;
  const hasAssets = assets.length > 0;

  useEffect(() => {
    if (!assetId && defaultAssetId) setAssetId(defaultAssetId);
  }, [assetId, defaultAssetId]);

  const handleSend = async () => {
    try {
      if (!assetId) return;
      const amt = parseAssetAmount(amount, selectedDecimals);
      await send({ from: accountId, to, assetId, amount: amt, noteType });
      setAmount('');
    } catch (error) {
      console.error(error);
    }
  };

  const claimNote = (id: string) => () => consume({ accountId, notes: [id] });
  const onAssetChange = (event: ChangeEvent<HTMLSelectElement>) =>
    setAssetId(event.target.value);
  const onNoteTypeChange = (event: ChangeEvent<HTMLSelectElement>) =>
    setNoteType(event.target.value as 'private' | 'public');
  const onToChange = (event: ChangeEvent<HTMLInputElement>) =>
    setTo(event.target.value);
  const onAmountChange = (event: ChangeEvent<HTMLInputElement>) =>
    setAmount(event.target.value);
  const canSend = Boolean(hasAssets && to && assetId && amount);
  const sendLabel = isSending ? 'Sending...' : 'Send';

  return (
    <div className="wallet">
      <h1>Wallet</h1>
      <Panel title="Address">
        <div className="mono">{account?.bech32id?.() ?? 'Loading...'}</div>
      </Panel>
      <Panel title="Balances">
        {assets.length === 0 ? (
          <div className="empty">None</div>
        ) : (
          <div className="list">
            {assets.map((asset) => (
              <div key={asset.assetId} className="row">
                <span className="mono">{asset.symbol ?? asset.assetId}</span>
                <span>{formatAssetAmount(asset.amount, asset.decimals)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Unclaimed notes">
        {consumableNoteSummaries.length === 0 ? (
          <div className="empty">None</div>
        ) : (
          <div className="list">
            {consumableNoteSummaries.map((summary) => {
              const id = summary.id;
              const label = formatNoteSummary(summary);
              return (
                <div key={id} className="row">
                  <span className="mono">{label}</span>
                  <button onClick={claimNote(id)} disabled={isConsuming}>
                    Claim
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <Panel title="Send">
        <div className="form">
          <select value={noteType} onChange={onNoteTypeChange}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
          <select
            value={assetId}
            onChange={onAssetChange}
            disabled={!hasAssets}
          >
            {hasAssets ? (
              assets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.symbol ?? asset.assetId}
                </option>
              ))
            ) : (
              <option value="">No assets</option>
            )}
          </select>
          <input
            placeholder="to account id"
            value={to}
            onChange={onToChange}
            disabled={!hasAssets}
          />
          <input
            placeholder="amount"
            value={amount}
            onChange={onAmountChange}
            disabled={!hasAssets}
          />
          <button disabled={!canSend || isSending} onClick={handleSend}>
            {sendLabel}
          </button>
        </div>
      </Panel>
    </div>
  );
}
```

---

## Running the Example

The complete upstream wallet example lives in
[`packages/react-sdk/examples/wallet` in the web-sdk v0.16.0 release](https://github.com/0xMiden/web-sdk/tree/v0.16.0/packages/react-sdk/examples/wallet).
Follow that example's README for its workspace setup and select testnet in its
provider configuration.

To exercise this repository's three React transaction examples on testnet:

```bash
cd web-client
yarn install
yarn dev
```

Open `/react-tutorials` and select an example. These examples create and fund their
own accounts; the wallet UI above starts with an empty wallet that needs funding.

### Resetting the MidenClientDB

The Miden client stores account and note data in the browser's IndexedDB.
Upgrading from v0.15 automatically recreates the Miden store; export private
notes and any other local data you need before upgrading. To manually reset only
Miden databases on the current origin, stop the current client, close other tabs using it, and run:

```javascript
(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (!db.name?.startsWith('MidenClientDB')) continue;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Miden tabs and retry'));
    });
    console.log(`Deleted Miden database: ${db.name}`);
  }
})();
```

---

## External Signer Integration

By default, the Miden React SDK manages keys internally using the browser's IndexedDB. However, for production applications you may want to integrate with external signers that provide enhanced security, key management, or authentication features.

### The useSigner Hook

The `useSigner()` hook from `@miden-sdk/react` provides a unified interface for interacting with any signer provider. When you wrap your app with a signer provider (Para, Turnkey, MidenFi, etc.), the hook returns the signer context with connection state and methods.

```tsx
import { useSigner } from '@miden-sdk/react';

function ConnectButton() {
  const signer = useSigner();

  // Returns null if no signer provider is present (local keystore mode)
  if (!signer) return null;

  const { isConnected, connect, disconnect, name } = signer;

  return isConnected ? (
    <button onClick={disconnect}>Disconnect {name}</button>
  ) : (
    <button onClick={connect}>Connect with {name}</button>
  );
}
```

The `useSigner()` hook returns:

- `isConnected`: Whether the signer is connected and ready
- `connect()`: Triggers the authentication flow
- `disconnect()`: Disconnects from the signer
- `name`: Display name of the signer (e.g., "Para", "Turnkey", "MidenFi")

This unified interface means your wallet UI code works the same regardless of which signer provider is used.

---

### External signer sessions in v0.16

The Para and Turnkey examples below import an **existing public testnet account**
controlled by the selected signer. Pass its ID as `existingAccountId`. This uses
`importAccountId` to avoid the new-account authentication-enum mismatch in React
SDK v0.16.0. An API key or organization ID alone does not create that account.

Use this shared wrapper in `SignerSession.tsx`. It mounts `MidenProvider` after
connection and unmounts it on disconnect, so reconnecting creates a fresh client
instead of calling v0.16.0's unavailable `setSignCb` method. Replace the original
provider wrapper in `main.tsx` with the selected signer example; do not nest two
`MidenProvider` instances.

```tsx
import type { ReactNode } from 'react';
import { MidenProvider, useSigner } from '@miden-sdk/react';

export function SignerSession({ children }: { children: ReactNode }) {
  const signer = useSigner();
  if (!signer?.isConnected) {
    return <button onClick={signer?.connect}>Connect wallet</button>;
  }
  return (
    <MidenProvider key={signer.storeName} config={{ rpcUrl: 'testnet' }}>
      {children}
    </MidenProvider>
  );
}
```

### Para: EVM Wallet Integration

[Para](https://docs.getpara.com/v2/introduction/welcome) provides a modal-based authentication flow that allows users to sign in with their EVM wallets (MetaMask, WalletConnect, etc.).

Use `@miden-sdk/para-react@0.16.0` with the 0.16 SDK packages.
Provide a Para API key for the selected environment.

Install the adapter and its peer dependencies:

```bash
yarn add @miden-sdk/para-react@0.16.0 @miden-sdk/para@0.16.0 @getpara/react-sdk-lite@^2.11.0 @getpara/web-sdk@^2.11.0 @tanstack/react-query@^5
yarn add -D vite-plugin-node-polyfills@^0.22.0
```

In `vite.config.ts`, import `paraVitePlugin` from `@miden-sdk/para-react/vite`
and add `paraVitePlugin()` to the existing `plugins` array. It supplies the
browser polyfills required by Para. Import `@getpara/react-sdk-lite/styles.css`
once in `src/main.tsx` for the connection modal.

**Integration:**

```tsx
import { ParaSignerProvider } from '@miden-sdk/para-react';
import { useSigner } from '@miden-sdk/react';
import { SignerSession } from './SignerSession';

function App({ existingAccountId }: { existingAccountId: string }) {
  return (
    <ParaSignerProvider apiKey="your-api-key" environment="PRODUCTION" importAccountId={existingAccountId}>
      <SignerSession>
        <Wallet />
      </SignerSession>
    </ParaSignerProvider>
  );
}

function Wallet() {
  const signer = useSigner();

  return (
    <div>
      {signer?.isConnected ? (
        <button onClick={signer.disconnect}>Disconnect</button>
      ) : (
        <button onClick={signer?.connect}>Connect with Para</button>
      )}
    </div>
  );
}
```

**ParaSignerProvider Props:**

| Prop                    | Type                                         | Description                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------ |
| `apiKey`                | `string`                                     | Your Para API key                          |
| `environment`           | `"PRODUCTION" \| "DEVELOPMENT" \| "SANDBOX"` | Para environment                           |
| `showSigningModal`      | `boolean`                                    | Whether to show signing confirmation modal |
| `customSignConfirmStep` | `CustomSignConfirmStep`                      | Custom signing confirmation UI             |

---

### Turnkey: App-Controlled Authentication

[Turnkey](https://turnkey.com/) provides programmatic key management, giving your application full control over the authentication flow.

Use `@miden-sdk/turnkey-react@0.16.0` with the 0.16 SDK packages.
Create a Turnkey organization and pass its ID in `config`.

Install the adapter and its peer dependencies:

```bash
yarn add @miden-sdk/turnkey-react@0.16.0 @miden-sdk/turnkey@0.16.0 @turnkey/core@^1.8.2 @turnkey/react-wallet-kit@^1.6.2 @turnkey/sdk-browser@^5.13.4
```

**Integration:**

```tsx
import { TurnkeySignerProvider } from '@miden-sdk/turnkey-react';
import { useSigner } from '@miden-sdk/react';
import { SignerSession } from './SignerSession';

function App({ existingAccountId }: { existingAccountId: string }) {
  return (
    <TurnkeySignerProvider config={{ defaultOrganizationId: "your-organization-id" }} importAccountId={existingAccountId}>
      <SignerSession>
        <Wallet />
      </SignerSession>
    </TurnkeySignerProvider>
  );
}

function Wallet() {
  const signer = useSigner();

  return (
    <div>
      {signer?.isConnected ? (
        <button onClick={signer.disconnect}>Disconnect</button>
      ) : (
        <button onClick={signer?.connect}>Connect with Turnkey</button>
      )}
    </div>
  );
}
```

After configuring the organization, `connect()` starts the Turnkey authentication flow: passkey login, wallet discovery, and account selection.

**TurnkeySignerProvider Props:**

| Prop     | Type                                   | Description                                                                                |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `config` | `TurnkeySignerProviderProps["config"]` | Required. Set `defaultOrganizationId`; `apiBaseUrl` defaults to `https://api.turnkey.com`. |

The `useTurnkeySigner()` hook is available for advanced use cases where you need direct access to the Turnkey `client`, the selected `account`, or the `setAccount()` method to manually control account selection.

---

### MidenFi: Wallet Adapter

[MidenFi](https://github.com/0xMiden/wallet) provides a wallet adapter pattern similar to Solana's wallet-adapter, enabling integration with the MidenFi ecosystem.

**Installation:**

```bash
yarn add @miden-sdk/miden-wallet-adapter-react@0.16.0 @miden-sdk/miden-wallet-adapter-base@0.16.0
```

**Usage:**

```tsx
import { MidenFiSignerProvider } from '@miden-sdk/miden-wallet-adapter-react';
import { WalletAdapterNetwork } from '@miden-sdk/miden-wallet-adapter-base';
import { useSigner } from '@miden-sdk/react';
import { SignerSession } from './SignerSession';

function App() {
  return (
    <MidenFiSignerProvider network={WalletAdapterNetwork.Testnet}>
      <SignerSession>
        <Wallet />
      </SignerSession>
    </MidenFiSignerProvider>
  );
}

function Wallet() {
  const signer = useSigner();

  return (
    <div>
      {signer?.isConnected ? (
        <button onClick={signer.disconnect}>Disconnect</button>
      ) : (
        <button onClick={signer?.connect}>Connect with MidenFi</button>
      )}
    </div>
  );
}
```

**MidenFiSignerProvider Props:**

| Prop                    | Type                    | Description                              |
| ----------------------- | ----------------------- | ---------------------------------------- |
| `network`               | `WalletAdapterNetwork`  | `Testnet`, `Devnet`, or `Localnet`       |
| `privateDataPermission` | `PrivateDataPermission` | Permission level for private data access |
| `allowedPrivateData`    | `AllowedPrivateData`    | Private-data categories the app requests |

Import the enums from `@miden-sdk/miden-wallet-adapter-base`. Do not pass raw
network strings, booleans, or string arrays in place of these enum values.

---

### Building a Custom Signer Provider

If you need to integrate with a different signing service, you can build your own signer provider by implementing the `SignerContextValue` interface and providing it via `SignerContext.Provider`.

Pass your service initializer as `initializeSigningService`. It must return the ID
of an existing public account on testnet, its serialized public key commitment,
and a callback that signs the SDK's serialized signing inputs. The callback must
verify the requested public key before signing. Account creation and deployment
belong to the signing service in this example: `importAccountId` imports that
account instead of rebuilding it with a new seed. This also avoids the new-account
auth-enum mismatch in the published React SDK v0.16.0.

Keep a non-null context while disconnected so `useSigner()` can expose `connect`
and `MidenProvider` waits for the signer. In v0.16, `accountConfig` is only read
when connected, although its TypeScript type is non-nullable; the assertion below
reflects that runtime guard. Import WASM classes from the core SDK and await
`MidenClient.ready()` before constructing them.

The keyed fragment remounts the child `MidenProvider` after each connection.
This avoids v0.16.0's reconnect path, which calls an unavailable `setSignCb`
method. The account-specific store name stays the same, preserving local data.

```tsx
import { Fragment, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import {
  SignerContext,
  type SignerContextValue,
  type SignerAccountConfig,
  type SignCallback,
} from '@miden-sdk/react';
import { AccountStorageMode, MidenClient } from '@miden-sdk/miden-sdk';

interface SigningService {
  // An existing public account on the network configured in MidenProvider.
  accountId: string;
  publicKeyCommitment: Uint8Array;
  signMessage: SignCallback;
  disconnect?: () => Promise<void>;
}

interface CustomSignerProviderProps {
  children: ReactNode;
  initializeSigningService: () => Promise<SigningService>;
}

export function CustomSignerProvider({
  children,
  initializeSigningService,
}: CustomSignerProviderProps) {
  const service = useRef<SigningService | null>(null);
  const [accountConfig, setAccountConfig] = useState<SignerAccountConfig | null>(null);
  const [connection, setConnection] = useState(0);

  const connect = useCallback(async () => {
    await MidenClient.ready();
    const connected = await initializeSigningService();
    service.current = connected;
    setAccountConfig({
      publicKeyCommitment: connected.publicKeyCommitment,
      storageMode: AccountStorageMode.public(),
      importAccountId: connected.accountId,
    });
    setConnection((previous) => previous + 1);
  }, [initializeSigningService]);

  const disconnect = useCallback(async () => {
    const connected = service.current;
    service.current = null;
    setAccountConfig(null);
    await connected?.disconnect?.();
  }, []);

  const signCb = useCallback<SignCallback>(async (pubKey, signingInputs) => {
    if (!service.current) throw new Error('CustomSigner is not connected');
    return service.current.signMessage(pubKey, signingInputs);
  }, []);

  const signerContext = useMemo<SignerContextValue>(() => ({
    signCb,
    // v0.16 only reads this field when isConnected is true.
    accountConfig: accountConfig!,
    storeName: accountConfig ? `custom_${accountConfig.importAccountId}` : 'custom',
    name: 'CustomSigner',
    isConnected: accountConfig !== null,
    connect,
    disconnect,
  }), [accountConfig, signCb, connect, disconnect]);

  return (
    <SignerContext.Provider value={signerContext}>
      <Fragment key={connection}>{children}</Fragment>
    </SignerContext.Provider>
  );
}
```

The `SignerContextValue` interface requires:

| Field           | Type                                             | Description                                                     |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `signCb`        | `(pubKey, signingInputs) => Promise<Uint8Array>` | Signs transaction inputs and returns the signature              |
| `accountConfig` | `SignerAccountConfig`                            | Public key commitment and storage mode                          |
| `storeName`     | `string`                                         | Unique suffix for IndexedDB isolation (e.g., "custom_walletId") |
| `name`          | `string`                                         | Display name for UI (e.g., "CustomSigner")                      |
| `isConnected`   | `boolean`                                        | Whether the signer is connected and ready                       |
| `connect`       | `() => Promise<void>`                            | Triggers the authentication flow                                |
| `disconnect`    | `() => Promise<void>`                            | Disconnects from the signer                                     |

---

## Continue Learning

Now that you've built a React wallet, explore these related topics:

- [Creating Multiple Notes in a Single Transaction](./creating_multiple_notes_tutorial.md) - Learn about batch operations
- [Miden React SDK Reference](https://github.com/0xMiden/web-sdk/tree/v0.16.0/packages/react-sdk) - Full API documentation
- [Miden Documentation](https://docs.miden.xyz/) - Core Miden concepts
