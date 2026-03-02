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

---

## Step 1: Project Setup and MidenProvider

First, create a new Vite + React project and install the Miden React SDK.

1. Create a new Vite project with React and TypeScript:

   ```bash
   yarn create vite miden-wallet --template react-ts
   cd miden-wallet
   ```

2. Install the Miden React SDK:

   ```bash
   yarn add @miden-sdk/react
   ```

3. Configure the `MidenProvider` in your `main.tsx` file. The provider initializes the Miden client and makes it available to all child components:

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
        prover: 'testnet',
      }}
    >
      <App />
    </MidenProvider>
  </React.StrictMode>,
);
```

The `MidenProvider` accepts a `config` object with the following options:

- `rpcUrl`: The RPC endpoint to connect to (`"testnet"`, `"devnet"`, or a custom URL)
- `prover`: The prover to use (`"testnet"` for delegated proving, or `"local"` for local proving)

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
        <button onClick={() => createWallet()} disabled={isCreating}>
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
import { useConsume, formatNoteSummary } from '@miden-sdk/react';

function UnclaimedNotes({
  accountId,
  consumableNoteSummaries,
}: {
  accountId: string;
  consumableNoteSummaries: Array<{ id: string }>;
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

The `useSend()` hook provides a function to send tokens to other accounts.

```tsx
import { useState, type ChangeEvent } from 'react';
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
  const [assetId, setAssetId] = useState(assets[0]?.assetId ?? '');
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
        prover: 'testnet',
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
import { NoteVisibility } from '@miden-sdk/miden-sdk';

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
  const handleCreate = () => createWallet();
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

To run a full working example, navigate to the `packages/react-sdk/examples/wallet` directory in the [miden-client](https://github.com/0xMiden/miden-client/) repository:

```bash
git clone https://github.com/0xMiden/miden-client.git
cd miden-client/packages/react-sdk/examples/wallet
yarn install
yarn dev
```

### Resetting the MidenClientDB

The Miden client stores account and note data in the browser's IndexedDB. To clear this data, paste the following into your browser console:

```javascript
(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    await indexedDB.deleteDatabase(db.name);
    console.log(`Deleted database: ${db.name}`);
  }
  console.log('All databases deleted.');
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

### Para: EVM Wallet Integration

[Para](https://para.space/) provides a modal-based authentication flow that allows users to sign in with their EVM wallets (MetaMask, WalletConnect, etc.).

**Installation:**

```bash
yarn add @miden-sdk/use-miden-para-react
```

**Usage:**

```tsx
import { ParaSignerProvider } from '@miden-sdk/use-miden-para-react';
import { MidenProvider, useSigner } from '@miden-sdk/react';

function App() {
  return (
    <ParaSignerProvider apiKey="your-api-key" environment="PRODUCTION">
      <MidenProvider config={{ rpcUrl: 'testnet' }}>
        <Wallet />
      </MidenProvider>
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
| `customSignConfirmStep` | `ReactNode`                                  | Custom signing confirmation UI             |

---

### Turnkey: App-Controlled Authentication

[Turnkey](https://turnkey.com/) provides programmatic key management, giving your application full control over the authentication flow.

**Installation:**

```bash
yarn add @miden-sdk/miden-turnkey-react @turnkey/sdk-browser
```

**Usage:**

```tsx
import { TurnkeySignerProvider } from '@miden-sdk/miden-turnkey-react';
import { MidenProvider, useSigner } from '@miden-sdk/react';

function App() {
  return (
    <TurnkeySignerProvider>
      <MidenProvider config={{ rpcUrl: 'testnet' }}>
        <Wallet />
      </MidenProvider>
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

Calling `connect()` handles the full Turnkey authentication flow: passkey login, wallet discovery, and account selection. No manual setup is needed.

**TurnkeySignerProvider Props:**

| Prop     | Type                               | Description                                                                                                                   |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `config` | `Partial<TurnkeySDKBrowserConfig>` | Optional. Defaults to `apiBaseUrl: "https://api.turnkey.com"` and `defaultOrganizationId` from `VITE_TURNKEY_ORG_ID` env var. |

The `useTurnkeySigner()` hook is available for advanced use cases where you need direct access to the Turnkey `client`, the selected `account`, or the `setAccount()` method to manually control account selection.

---

### MidenFi: Wallet Adapter

[MidenFi](https://miden.fi/) provides a wallet adapter pattern similar to Solana's wallet-adapter, enabling integration with the MidenFi ecosystem.

**Installation:**

```bash
yarn add @miden-sdk/miden-wallet-adapter-react
```

**Usage:**

```tsx
import { MidenFiSignerProvider } from '@miden-sdk/miden-wallet-adapter-react';
import { MidenProvider, useSigner } from '@miden-sdk/react';

function App() {
  return (
    <MidenFiSignerProvider network="Testnet">
      <MidenProvider config={{ rpcUrl: 'testnet' }}>
        <Wallet />
      </MidenProvider>
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

| Prop                    | Type                     | Description                            |
| ----------------------- | ------------------------ | -------------------------------------- |
| `network`               | `"Testnet" \| "Mainnet"` | Target network                         |
| `privateDataPermission` | `boolean`                | Whether to request private data access |
| `allowedPrivateData`    | `string[]`               | List of allowed private data types     |

---

### Building a Custom Signer Provider

If you need to integrate with a different signing service, you can build your own signer provider by implementing the `SignerContextValue` interface and providing it via `SignerContext.Provider`.

```tsx
import { useState, useCallback, type ReactNode } from 'react';
import { SignerContext, type SignerContextValue } from '@miden-sdk/react';
import { AccountStorageMode } from '@miden-sdk/miden-sdk';

interface CustomSignerProviderProps {
  children: ReactNode;
  // Your provider-specific config
}

export function CustomSignerProvider({ children }: CustomSignerProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [signerContext, setSignerContext] = useState<SignerContextValue | null>(
    null,
  );

  const connect = useCallback(async () => {
    // 1. Initialize your signing service and get credentials
    const { publicKeyCommitment, signMessage } =
      await initializeYourSigningService();

    // 2. Build the signer context
    const context: SignerContextValue = {
      signCb: async (pubKey, signingInputs) => {
        // Sign the message using your service
        return signMessage(signingInputs);
      },
      accountConfig: {
        publicKeyCommitment,
        accountType: 'RegularAccountImmutableCode',
        storageMode: AccountStorageMode.public(),
      },
      storeName: 'custom_signer',
      name: 'CustomSigner',
      isConnected: true,
      connect,
      disconnect,
    };

    setSignerContext(context);
    setIsConnected(true);
  }, []);

  const disconnect = useCallback(async () => {
    setSignerContext(null);
    setIsConnected(false);
  }, []);

  return (
    <SignerContext.Provider value={signerContext}>
      {children}
    </SignerContext.Provider>
  );
}
```

The `SignerContextValue` interface requires:

| Field           | Type                                             | Description                                                     |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `signCb`        | `(pubKey, signingInputs) => Promise<Uint8Array>` | Signs transaction inputs and returns the signature              |
| `accountConfig` | `SignerAccountConfig`                            | Public key commitment, account type, and storage mode           |
| `storeName`     | `string`                                         | Unique suffix for IndexedDB isolation (e.g., "custom_walletId") |
| `name`          | `string`                                         | Display name for UI (e.g., "CustomSigner")                      |
| `isConnected`   | `boolean`                                        | Whether the signer is connected and ready                       |
| `connect`       | `() => Promise<void>`                            | Triggers the authentication flow                                |
| `disconnect`    | `() => Promise<void>`                            | Disconnects from the signer                                     |

---

## Continue Learning

Now that you've built a React wallet, explore these related topics:

- [Creating Multiple Notes in a Single Transaction](./creating_multiple_notes_tutorial.md) - Learn about batch operations
- [Miden React SDK Reference](https://github.com/0xMiden/miden-client/tree/main/packages/react-sdk) - Full API documentation
- [Miden Documentation](https://docs.miden.io/) - Core Miden concepts
