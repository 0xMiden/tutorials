---
title: 'Creating Accounts and Deploying Faucets'
sidebar_position: 2
---

import { CodeSdkTabs } from '@site/src/components';

_Using the Miden client in TypeScript to create accounts and deploy faucets_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.
For React snippets, initialize `authScheme` with `await tutorialAuthScheme()`
as shown in the complete example.

:::

## Overview

In this tutorial, we'll build a simple Next.js application that demonstrates the fundamentals of interacting with the Miden blockchain using the Miden SDK. We'll walk through creating a Miden account for Alice and deploying a fungible faucet contract that can mint tokens. This sets the foundation for more complex operations like issuing assets and transferring them between accounts.

## What we'll cover

- Understanding the difference between public and private accounts & notes
- Instantiating the Miden client
- Creating new accounts (public or private)
- Deploying a faucet to fund an account

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

## Public vs. private accounts & notes

Before we dive into code, a quick refresher:

- **Public accounts**: The account's data and code are stored on-chain and are openly visible, including its assets.
- **Private accounts**: The account's state and logic are kept off-chain. The owner retains them locally and can share them; the chain records the account commitment.
- **Public notes**: The note's state is visible to anyone - perfect for scenarios where transparency is desired.
- **Private notes**: The note's state is stored off-chain, you will need to share the note data with the relevant parties (via email or Telegram) for them to be able to consume the note.

> **Important**: In Miden, "accounts" and "smart contracts" can be used interchangeably due to native account abstraction. Every account is programmable and can contain custom logic.

It is useful to think of notes on Miden as "cryptographic cashier's checks" that allow users to send tokens. Private note details must be shared with the recipient. The chain still records public note metadata, the note commitment, and its eventual nullifier; privacy also depends on how the details and transaction witness are shared.

## Step 1: Initialize your Next.js project

1. Create a new Next.js app with TypeScript:

   ```bash
   npx create-next-app@latest miden-web-app --typescript
   ```

   Hit enter for all terminal prompts.

2. Change into the project directory:

   ```bash
   cd miden-web-app
   ```

3. Install the Miden SDK:

<CodeSdkTabs example={{
  react: { code: `yarn add @miden-sdk/react@0.16.0 @miden-sdk/miden-sdk@0.16.0` },
  typescript: { code: `yarn add @miden-sdk/miden-sdk@0.16.0` },
}} reactFilename="" tsFilename="" />

The current Next.js template uses Turbopack by default. These SDK examples use the webpack configuration from the setup guide, so update both scripts in `package.json`:

`package.json`

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
```

## Step 2: Set up the Miden client

The Miden client is your gateway to interact with the Miden blockchain. It handles state synchronization, transaction creation, and proof generation. Let's set it up.

### Create the library file

First, we'll create a separate file for our blockchain logic. In the project root, create a folder `lib/` and inside it `lib/react/createMintConsume.tsx` (React) or `lib/createMintConsume.ts` (TypeScript):

```bash
mkdir -p lib/react
```

<CodeSdkTabs example={{
react: { code: `// lib/react/createMintConsume.tsx
'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet } from '@miden-sdk/react/lazy';
import { StorageMode } from '@miden-sdk/miden-sdk/lazy';

function CreateMintConsumeInner() {
.const { isReady } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();

.const run = async () => {
..// We'll add our logic here
..console.log('Ready to go!');
.};

.return (
..<div>
...<button onClick={run} disabled={!isReady}>
....{isReady ? 'Start' : 'Initializing…'}
...</button>
..</div>
.);
}

export default function CreateMintConsume() {
.return (
..<MidenProvider config={{ rpcUrl: 'testnet', prover: 'local' }}>
...<CreateMintConsumeInner />
..</MidenProvider>
.);
}`},
  typescript: { code:`// lib/createMintConsume.ts
import { MidenClient, StorageMode } from '@miden-sdk/miden-sdk/lazy';

export async function createMintConsume(): Promise<void> {
.if (typeof window === 'undefined') {
..console.warn('webClient() can only run in the browser');
..return;
.}

.// Wait for the WASM module to finish initializing before touching any
.// wasm-bindgen type (see setup_guide.md "Entry points: eager vs lazy").
.await MidenClient.ready();

.// Connect to Miden testnet with local proving
.const client = await MidenClient.createTestnet({
..proverUrl: 'local',
.});

.// 1. Sync with the latest blockchain state
.// This fetches the latest block header and state commitments
.const state = await client.sync();
.console.log('Latest block number:', state.blockNum());

.// At this point, your client is connected and synchronized
.// Ready to create accounts and deploy contracts!
}` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

> Since we will be handling proof generation in the browser, it will be slower than proof generation handled by the Rust client. Check out the [tutorial on delegated proving](./creating_multiple_notes_tutorial.md#what-is-delegated-proving) to speed up proof generation in the browser.

## Step 3: Create the User Interface

Now let's create a simple UI that will trigger our blockchain interactions. We'll replace the default Next.js page with a button that calls our function.

Edit `app/page.tsx`:

If you're using the **React SDK**, the page simply renders your self-contained component:

```tsx
// app/page.tsx
'use client';
import CreateMintConsume from '../lib/react/createMintConsume';

export default function Home() {
  return <CreateMintConsume />;
}
```

If you're using the **TypeScript SDK**, the page manages state and calls the library function directly:

```tsx
// app/page.tsx
'use client';
import { useState } from 'react';
import { createMintConsume } from '../lib/createMintConsume';

export default function Home() {
  const [isCreatingNotes, setIsCreatingNotes] = useState(false);

  const handleCreateMintConsume = async () => {
    setIsCreatingNotes(true);
    await createMintConsume();
    setIsCreatingNotes(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black text-slate-800 dark:text-slate-100">
      <div className="text-center">
        <h1 className="text-4xl font-semibold mb-4">Miden Web App</h1>
        <p className="mb-6">
          Open your browser console to see Miden client logs.
        </p>

        <div className="max-w-sm w-full bg-gray-800/20 border border-gray-600 rounded-2xl p-6 mx-auto flex flex-col gap-4">
          <button
            onClick={handleCreateMintConsume}
            className="w-full px-6 py-3 text-lg cursor-pointer bg-transparent border-2 border-orange-600 text-white rounded-lg transition-all hover:bg-orange-600 hover:text-white"
          >
            {isCreatingNotes
              ? 'Working...'
              : 'Tutorial #1: Create a wallet and deploy a faucet'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

## Step 4: Create Alice's Wallet Account

Now we'll create Alice's account. Let's create a **public** account so we can easily track her transactions.

Back in your library file, extend the function:

<CodeSdkTabs example={{
react: { code: `const run = async () => {
.// 1. Create Alice's wallet (public, mutable)
.console.log('Creating account for Alice…');
.const alice = await createWallet({ storageMode: StorageMode.Public, authScheme });
.console.log('Alice ID:', alice.id().toString());
};` },
typescript: { code: `// lib/createMintConsume.ts
import { MidenClient, StorageMode } from '@miden-sdk/miden-sdk/lazy';

export async function createMintConsume(): Promise<void> {
.if (typeof window === 'undefined') {
..console.warn('webClient() can only run in the browser');
..return;
.}

.// Wait for the WASM module to finish initializing before touching any
.// wasm-bindgen type (see setup_guide.md "Entry points: eager vs lazy").
.await MidenClient.ready();

.const client = await MidenClient.createTestnet({
..proverUrl: 'local',
.});

.// 1. Sync with the latest blockchain state
.const state = await client.sync();
.console.log('Latest block number:', state.blockNum());

.// 2. Create Alice's account
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..storage: StorageMode.Public, // Public: account state is visible on-chain
.});
.console.log('Alice ID:', alice.id().toString());
}` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

## Step 5: Deploy a Fungible Faucet

A faucet in Miden is a special type of account that can mint new tokens. Think of it as your own token factory. Let's deploy one that will create our custom "MID" tokens.

Add this code after creating Alice’s account. Use `fundAccount` from `useTutorialSupport` in React, or import `fundAccountForFees` from `./feeSupport` in TypeScript, as shown in the complete example. Consuming native fee funding is the first transaction that deploys each account.

<CodeSdkTabs example={{
react: { code: `// 2. Deploy a fungible faucet
console.log('Creating faucet…');
const faucet = await createFaucet({
.authScheme,
.tokenSymbol: 'MID', // Token symbol (like ETH, BTC, etc.)
.decimals: 8, // Decimals (8 means 1 MID = 100,000,000 base units)
.maxSupply: BigInt(1_000_000), // Max supply: total tokens that can ever be minted
.storageMode: StorageMode.Public, // Public: faucet operations are transparent
});
console.log('Faucet account ID:', faucet.id().toString());
await fundAccount(alice);
await fundAccount(faucet);
console.log('Setup complete.');`},
  typescript: { code:`// 3. Deploy a fungible faucet
// A faucet is an account that can mint new tokens
console.log('Creating faucet…');
const faucet = await client.accounts.create({
.type: 0, // 0 = FungibleFaucet: can mint divisible tokens
.symbol: 'MID', // Token symbol (like ETH, BTC, etc.)
.decimals: 8, // Decimals (8 means 1 MID = 100,000,000 base units)
.maxSupply: BigInt(1_000_000), // Max supply: total tokens that can ever be minted
.storage: StorageMode.Public, // Public: faucet operations are transparent
});
console.log('Faucet account ID:', faucet.id().toString());
await fundAccountForFees(client, alice);
await fundAccountForFees(client, faucet);
console.log('Setup complete.');` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

### Understanding Faucet Parameters:

- **Storage**: We use `StorageMode.Public` so anyone can verify the faucet's minting operations
- **Faucet selection**: In the TypeScript facade a fungible faucet is selected with `type: 0`; the React SDK exposes this directly via `createFaucet`
- **Token Symbol**: A short identifier for your token (e.g., "MID", "USDC", "DAI")
- **Decimals**: Determines the smallest unit of your token. With 8 decimals, 1 MID = 10^8 base units
- **Max Supply**: The maximum number of tokens that can ever exist

> **Note**: When tokens are minted from a faucet, they're created as "notes" - Miden's version of UTXOs. Each note contains tokens and can have specific spending conditions.

## Summary

In this tutorial, we've successfully:

1. Set up a Next.js application with the Miden SDK
2. Connected to Miden testnet
3. Created a wallet account for Alice
4. Deployed a fungible faucet that can mint custom tokens

Your final `lib/react/createMintConsume.tsx` (React) or `lib/createMintConsume.ts` (TypeScript) should look like:

<CodeSdkTabs example={{
react: { code: `'use client';

import {
.MidenProvider,
.useMiden,
.useCreateWallet,
.useCreateFaucet,
} from '@miden-sdk/react/lazy';
import { StorageMode } from '@miden-sdk/miden-sdk/lazy';
import { tutorialNetwork } from '../feeSupport';
import {
.TutorialButton,
.tutorialAuthScheme,
.useTutorialSupport,
} from './tutorialSupport';

function CreateMintConsumeInner() {
.const { sync } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { fundAccount } = useTutorialSupport();

.const run = async () => {
..console.log('Synchronizing before creating accounts…');
..await sync();
..console.log('Creating Alice with useCreateWallet…');
..const authScheme = await tutorialAuthScheme();
..// Native fee tokens and the tutorial's MID token are separate assets.
..const alice = await createWallet({
...storageMode: StorageMode.Public,
...authScheme,
..});
..console.log('Alice ID:', alice.id().toString());
..await fundAccount(alice);

..// v0.16 faucets include BasicWallet, so they can receive fee funding.
..const faucet = await createFaucet({
...tokenSymbol: 'MID',
...decimals: 8,
...maxSupply: BigInt(1_000_000),
...storageMode: StorageMode.Public,
...authScheme,
..});
..console.log('Faucet ID:', faucet.id().toString());
..await fundAccount(faucet);

..console.log('Setup complete.');
.};

.return (
..<TutorialButton
...name="createMintConsume"
...label="Run: Create Wallet & Deploy Faucet"
...run={run}
../>
.);
}

export default function CreateMintConsume() {
.return (
..<MidenProvider
...config={{
....rpcUrl: tutorialNetwork(),
....prover: 'local',
....autoSyncInterval: 0,
...}}
..>
...<CreateMintConsumeInner />
..</MidenProvider>
.);
}`},
  typescript: { code: `// lib/createMintConsume.ts
import { StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
.createTutorialClient,
.fundAccountForFees,
} from './feeSupport';

export async function createMintConsume(): Promise<void> {
.if (typeof window === 'undefined') {
..console.warn('webClient() can only run in the browser');
..return;
.}

.const client = await createTutorialClient({
..proverUrl: 'local',
.});

.// 1. Sync with the latest blockchain state
.const state = await client.sync();
.console.log('Latest block number:', state.blockNum());

.// 2. Create Alice's account
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..storage: StorageMode.Public,
.});
.console.log('Alice ID:', alice.id().toString());

.// 3. Create our own fungible faucet. SDK v0.16 includes BasicWallet,
.// allowing both accounts to consume native fee funding before minting MID.
.console.log('Creating faucet…');
.const faucet = await client.accounts.create({
..type: 0, // 0 = FungibleFaucet
..symbol: 'MID',
..decimals: 8,
..maxSupply: BigInt(1_000_000),
..storage: StorageMode.Public,
.});
.console.log('Faucet ID:', faucet.id().toString());
.await fundAccountForFees(client, alice);
.await fundAccountForFees(client, faucet);

.console.log('Setup complete.');
}` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

### Running the example

From the parent directory of `miden-web-app`:

```bash
cd miden-web-app
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser, click **Tutorial #1: Create a wallet and deploy a faucet**, and check the browser console (F12 or right-click → Inspect → Console):

```
Latest block number: <testnet block>
Creating account for Alice…
Alice ID: <testnet account>
Creating faucet…
Faucet ID: <testnet account>
Setup complete.
```

## What's Next?

Now that you have:

- A wallet account for Alice that can hold tokens
- A faucet that can mint new MID tokens

In the next tutorial, we'll:

1. Mint tokens from the faucet to Alice's account
2. Consume notes
3. Transfer tokens between accounts
