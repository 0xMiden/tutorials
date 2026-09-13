---
title: 'Creating Multiple Notes in a Single Transaction'
sidebar_position: 4
---

import { CodeSdkTabs } from '@site/src/components';

_Using the Miden client in TypeScript to create several P2ID notes in a single transaction_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.
For React snippets, initialize `authScheme` with `await tutorialAuthScheme()`
as shown in the complete example.

:::

## Overview

In the previous sections we learned how to create accounts, deploy faucets, and mint tokens. In this tutorial we will:

- **Mint** test tokens from a faucet to Alice
- **Consume** the minted notes so the assets appear in Alice's wallet
- **Create three P2ID notes in a _single_ transaction** using standard P2ID notes and delegated proving

The entire flow is wrapped in a helper called `multiSendWithDelegatedProver()` that you can call from any browser page.

## What we'll cover

1. Setting-up the Miden client
2. Building three P2ID notes worth 100 `MID` each
3. Submitting the transaction _using delegated proving_

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

## What is Delegated Proving?

Before diving into our code example, let's clarify what in the world "delegated proving" actually is.

Delegated proving moves transaction proof generation to a remote service. This can reduce the work required on a mobile device or in a browser. The time to submit a transaction still depends on execution, network latency, prover capacity, and node settlement.

_How does it work?_ The client sends a transaction witness to the delegated prover, receives the generated proof, and submits the proven transaction to the node. The node verifies the proof. Delegation shares the witness with the prover, including private data needed for execution; use local proving when those inputs must remain on your device.

Anyone can run their own delegated prover server. If you are building a product on Miden, it may make sense to run your own delegated prover server for your users. To run your own delegated proving server, follow the instructions here: https://crates.io/crates/miden-proving-service

The code below uses `client.transactions.submit()`, which handles proving via the network's delegated
proving service. This means your browser never has to generate the full ZK proof locally.

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

## Step 2: Edit the `app/page.tsx` file:

Add the following code to the `app/page.tsx` file:

If you're using the **React SDK**, the page simply renders your self-contained component:

```tsx
// app/page.tsx
'use client';
import MultiSendWithDelegatedProver from '../lib/react/multiSendWithDelegatedProver';

export default function Home() {
  return <MultiSendWithDelegatedProver />;
}
```

If you're using the **TypeScript SDK**, the page manages state and calls the library function directly:

```tsx
// app/page.tsx
'use client';
import { useState } from 'react';
import { multiSendWithDelegatedProver } from '../lib/multiSendWithDelegatedProver';

export default function Home() {
  const [isMultiSendNotes, setIsMultiSendNotes] = useState(false);

  const handleMultiSendNotes = async () => {
    setIsMultiSendNotes(true);
    await multiSendWithDelegatedProver();
    setIsMultiSendNotes(false);
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
            onClick={handleMultiSendNotes}
            className="w-full px-6 py-3 text-lg cursor-pointer bg-transparent border-2 border-orange-600 text-white rounded-lg transition-all hover:bg-orange-600 hover:text-white"
          >
            {isMultiSendNotes
              ? 'Working...'
              : 'Tutorial #2: Send 1 to N P2ID Notes with Delegated Proving'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

## Step 3 — Initialize the Miden client

Create `lib/react/multiSendWithDelegatedProver.tsx` (React) or `lib/multiSendWithDelegatedProver.ts` (TypeScript) and add the following code. This snippet initializes the Miden client.

```bash
mkdir -p lib/react
```

<CodeSdkTabs example={{
react: { code: `'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useMultiSend } from '@miden-sdk/react/lazy';
import {tutorialAuthScheme, useTutorialSupport} from './tutorialSupport';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

function MultiSendInner() {
.const { isReady, sync } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { sendMany } = useMultiSend();
.const { fundAccount, committed, waitForTokenNotes, assertBalance } =
..useTutorialSupport();

.const run = async () => {
..await sync();
..const authScheme = await tutorialAuthScheme();
..// We'll add our logic here
.};

.return (
..<div>
...<button onClick={run} disabled={!isReady}>
....{isReady ? 'Run: Multi-Send' : 'Initializing…'}
...</button>
..</div>
.);
}

export default function MultiSendWithDelegatedProver() {
.return (
..<MidenProvider config={{ rpcUrl: 'testnet', prover: 'testnet' }}>
...<MultiSendInner />
..</MidenProvider>
.);
}`},
  typescript: { code:`import {
.MidenClient,
.NoteVisibility,
.StorageMode,
.createP2IDNote,
.NoteArray,
} from '@miden-sdk/miden-sdk/lazy';
import { fundAccountForFees, consumeAllFeeAware } from './feeSupport';

export async function multiSendWithDelegatedProver(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.// Wait for WASM to be ready before touching any wasm-bindgen type.
.await MidenClient.ready();

.const client = await MidenClient.createTestnet();

.console.log('Latest block:', (await client.sync()).blockNum());
}` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Step 4 — Create an account, deploy a faucet, mint and consume tokens

Add the code below to the function. The shared helpers imported in Step 3 fund Alice and the faucet with native fee tokens, wait for confirmation and select the tutorial notes before consuming them. The React helpers come from the same `tutorialSupport` file used by the complete example.

<CodeSdkTabs example={{
react: { code: `// 1. Create Alice's wallet
console.log('Creating account for Alice…');
const alice = await createWallet({ storageMode: StorageMode.Public, authScheme });
const aliceId = alice.id().toString();
console.log('Alice account ID:', aliceId);

// 2. Deploy a fungible faucet
const faucet = await createFaucet({
.authScheme,
.tokenSymbol: 'MID',
.decimals: 8,
.maxSupply: BigInt(1_000_000),
.storageMode: StorageMode.Public,
});
const faucetId = faucet.id().toString();
console.log('Faucet ID:', faucetId);
await fundAccount(alice);
await fundAccount(faucet);

// 3. Mint 10,000 MID to Alice
const mintResult = await mint({
.faucetId,
.targetAccountId: aliceId,
.amount: BigInt(10_000),
.noteType: NoteVisibility.Public,
});

console.log('Waiting for settlement…');
await committed(mintResult.transactionId);

// 4. Consume the freshly minted notes
const notes = await waitForTokenNotes(alice, faucet);
const consumed = await consume({ accountId: aliceId, notes });
await committed(consumed.transactionId);
await assertBalance(alice, faucet, BigInt(10_000));`},
  typescript: { code:`// ── Creating new account ──────────────────────────────────────────────────────
console.log('Creating account for Alice…');
const alice = await client.accounts.create({
.storage: StorageMode.Public,
});
console.log('Alice account ID:', alice.id().toString());

// ── Creating new faucet ──────────────────────────────────────────────────────
const faucet = await client.accounts.create({
.type: 0, // 0 = FungibleFaucet
.symbol: 'MID',
.decimals: 8,
.maxSupply: BigInt(1_000_000),
.storage: StorageMode.Public,
});
console.log('Faucet ID:', faucet.id().toString());
await fundAccountForFees(client, alice);
await fundAccountForFees(client, faucet);

// ── mint 10 000 MID to Alice ──────────────────────────────────────────────────────
const { txId: mintTxId } = await client.transactions.mint({
.account: faucet,
.to: alice,
.amount: BigInt(10_000),
.type: NoteVisibility.Public,
});

console.log('waiting for settlement');
await client.transactions.waitFor(mintTxId, { timeout: 120_000 });

// ── consume the freshly minted notes ──────────────────────────────────────────────
await consumeAllFeeAware(client, alice);` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Step 5 — Build and Create P2ID notes

Add the following code to the function. This code creates three testnet recipients, builds a P2ID note with 100 `MID` for each, and then creates all three notes in the same transaction.

<CodeSdkTabs example={{
react: { code: `// 5. Create three recipients and send 100 MID to each in one transaction
const recipients = await Promise.all(
.Array.from({ length: 3 }, () =>
..createWallet({ storageMode: StorageMode.Public, authScheme }),
.),
);

const sent = await sendMany({
.from: alice,
.assetId: faucet,
.recipients: recipients.map((account) => ({
..to: account.id().toString(),
..amount: BigInt(100),
.})),
.noteType: NoteVisibility.Public,
});

await committed(sent.transactionId);
await assertBalance(alice, faucet, BigInt(9700));
console.log('All notes created ✅');`},
  typescript: { code:`// ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
const recipients = await Promise.all(
.Array.from({ length: 3 }, () =>
..client.accounts.create({ storage: StorageMode.Public }),
.),
);
const recipientAddresses = recipients.map((account) =>
.account.id().toString(),
);

const p2idNotes = recipientAddresses.map((addr) =>
.createP2IDNote({
..from: alice,
..to: addr,
..assets: { token: faucet, amount: BigInt(100) },
..type: NoteVisibility.Public,
.}),
);

// ── create all P2ID notes ───────────────────────────────────────────────────────────────
await client.sync();
const builder = await client.feeAwareTransactionRequestBuilder(alice);
const outputs = new NoteArray();
for (const note of p2idNotes) outputs.push(note);
const txRequest = builder.withOwnOutputNotes(outputs).build();
const { txId } = await client.transactions.submit(alice, txRequest);
await client.transactions.waitFor(txId, { timeout: 120_000 });

console.log('All notes created ✅');` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Summary

Your library file should now look like this:

<CodeSdkTabs example={{
react: { code: `'use client';

import {
.MidenProvider,
.useMiden,
.useCreateWallet,
.useCreateFaucet,
.useMint,
.useConsume,
.useMultiSend,
} from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import { tutorialNetwork } from '../feeSupport';
import {
.TutorialButton,
.tutorialAuthScheme,
.useTutorialSupport,
} from './tutorialSupport';

function MultiSendInner() {
.const { sync } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { sendMany } = useMultiSend();
.const { fundAccount, committed, waitForTokenNotes, assertBalance } =
..useTutorialSupport();

.const run = async () => {
..await sync();
..const authScheme = await tutorialAuthScheme();
..const alice = await createWallet({
...storageMode: StorageMode.Public,
...authScheme,
..});
..console.log('Alice ID:', alice.id().toString());
..await fundAccount(alice);
..const faucet = await createFaucet({
...tokenSymbol: 'MID',
...decimals: 8,
...maxSupply: BigInt(1_000_000),
...storageMode: StorageMode.Public,
...authScheme,
..});
..console.log('Faucet ID:', faucet.id().toString());
..await fundAccount(faucet);

..await sync();
..const minted = await mint({
...faucetId: faucet,
...targetAccountId: alice,
...amount: BigInt(10_000),
...noteType: NoteVisibility.Public,
..});
..await committed(minted.transactionId);
..const notes = await waitForTokenNotes(alice, faucet);
..const consumed = await consume({ accountId: alice.id().toString(), notes });
..await committed(consumed.transactionId);

..const recipients = [];
..for (let index = 0; index < 3; index += 1) {
...recipients.push(
....await createWallet({ storageMode: StorageMode.Public, authScheme }),
...);
..}
..const sent = await sendMany({
...from: alice,
...assetId: faucet,
...recipients: recipients.map((account) => ({
....to: account,
....amount: BigInt(100),
...})),
...noteType: NoteVisibility.Public,
..});
..await committed(sent.transactionId);
..for (const recipient of recipients) {
...const outputs = await waitForTokenNotes(recipient, faucet);
...if (
....outputs.length !== 1 ||
....outputs[0].details().assets().fungibleAssets()[0]?.amount() !==
.....BigInt(100)
...) {
....throw new Error(\`Expected one 100 MID note for \${recipient.id()}\`);
...}
..}
..await assertBalance(alice, faucet, BigInt(9700));
..console.log('All notes created ✅');
.};

.return (
..<TutorialButton
...name="multiSendWithDelegatedProver"
...label="Run: Multi-Send with Delegated Proving"
...run={run}
../>
.);
}

export default function MultiSendWithDelegatedProver() {
.return (
..<MidenProvider
...config={{
....rpcUrl: tutorialNetwork(),
....prover: tutorialNetwork(),
....autoSyncInterval: 0,
...}}
..>
...<MultiSendInner />
..</MidenProvider>
.);
}`},
  typescript: { code: `import {
.NoteArray,
.NoteVisibility,
.StorageMode,
.createP2IDNote,
} from '@miden-sdk/miden-sdk/lazy';
import {
.consumeAllFeeAware,
.createTutorialClient,
.fundAccountForFees,
} from './feeSupport';

export async function multiSendWithDelegatedProver(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.const client = await createTutorialClient();

.console.log('Latest block:', (await client.sync()).blockNum());

.// ── Creating new account ──────────────────────────────────────────────────────
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..storage: StorageMode.Public,
.});
.console.log('Alice account ID:', alice.id().toString());

.// ── Creating new faucet ────────────────────────────────────────────────────
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

.// ── mint 10 000 MID to Alice ───────────────────────────────────────────────
.await client.sync();
.const { txId: mintTxId } = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(10_000),
..type: NoteVisibility.Public,
.});
.console.log('waiting for settlement');
.await client.transactions.waitFor(mintTxId, { timeout: 120_000 });
.await consumeAllFeeAware(client, alice);

.// ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
.const recipients = await Promise.all(
..Array.from({ length: 3 }, () =>
...client.accounts.create({ storage: StorageMode.Public }),
..),
.);
.const recipientAddresses = recipients.map((account) =>
..account.id().toString(),
.);

.const p2idNotes = recipientAddresses.map((addr) =>
..createP2IDNote({
...from: alice,
...to: addr,
...assets: { token: faucet, amount: BigInt(100) },
...type: NoteVisibility.Public,
..}),
.);

.// ── create all P2ID notes ───────────────────────────────────────────────────────────────
.await client.sync();
.const builder = await client.feeAwareTransactionRequestBuilder(alice);
.const outputs = new NoteArray();
.for (const note of p2idNotes) outputs.push(note);
.const request = builder.withOwnOutputNotes(outputs).build();
.const { txId } = await client.transactions.submit(alice, request);
.await client.transactions.waitFor(txId, { timeout: 120_000 });
.console.log(\`Transaction committed: \${txId.toHex()}\`);
.const updatedAlice = await client.accounts.get(alice);
.const balance = updatedAlice?.vault().getBalance(faucet.id());
.if (balance !== BigInt(9_700))
..throw new Error(\`Expected Alice to retain 9700 MID, got \${balance}\`);

.console.log('All notes created ✅');
}` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

### Running the example

To run a full working example navigate to the `web-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run the web application example:

```bash
cd web-client
yarn install
yarn dev
```

### Resetting the `MidenClientDB`

The Miden webclient stores account and note data in IndexedDB. Stop or terminate the tutorial client and close other tabs using its store before resetting it. This deletes local account data and keys, so use it only for disposable tutorial accounts. The following browser-console snippet deletes the default testnet `MidenClientDB_mtst` store after the deletion request completes; change `name` if you configured a different store.

```javascript
(async () => {
  const name = 'MidenClientDB_mtst';
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Close clients and tabs using this store, then retry.'));
  });
  console.log(`Deleted database: ${name}`);
})();
```
