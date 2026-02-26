---
title: 'Creating Multiple Notes in a Single Transaction'
sidebar_position: 4
---

import { CodeSdkTabs } from '@site/src/components';

_Using the Miden WebClient in TypeScript to create several P2ID notes in a single transaction_

## Overview

In the previous sections we learned how to create accounts, deploy faucets, and mint tokens. In this tutorial we will:

- **Mint** test tokens from a faucet to Alice
- **Consume** the minted notes so the assets appear in Alice's wallet
- **Create three P2ID notes in a _single_ transaction** using a custom note‑script and delegated proving

The entire flow is wrapped in a helper called `multiSendWithDelegatedProver()` that you can call from any browser page.

## What we'll cover

1. Setting‑up the WebClient
2. Building three P2ID notes worth 100 `MID` each
3. Submitting the transaction _using delegated proving_

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

## What is Delegated Proving?

Before diving into our code example, let's clarify what in the world "delegated proving" actually is.

Delegated proving is the process of outsourcing a part of the ZK proof generation of your transaction to a third party. For certain computationally constrained devices such as mobile phones and web browser environments, generating ZK proofs might take too long to ensure an acceptable user experience. Devices that do not have the computational resources to generate Miden proofs in under 1-2 seconds can use delegated proving to provide a more responsive user experience.

_How does it work?_ When a user choses to use delegated proving, they send off a portion of the zk proof of their transaction to a dedicated server. This dedicated server generates the remainder of the ZK proof of the transaction and submits it to the network. Submitting a transaction with delegated proving is trustless, meaning if the delegated prover is malicious, the could not compromise the security of the account that is submitting a transaction to be processed by the delegated prover. The downside of using delegated proving is that it reduces the privacy of the account that uses delegated proving, because the delegated prover would have knowledge of the transaction that is being proven. Additionally, transactions that require sensitive data such as the knowledge of a hash preimage or a secret, should not use delegated proving as this data will be shared with the delegated prover for proof generation.

Anyone can run their own delegated prover server. If you are building a product on Miden, it may make sense to run your own delegated prover server for your users. To run your own delegated proving server, follow the instructions here: https://crates.io/crates/miden-proving-service

The code below uses `client.transactions.submit()`, which handles proving via the network's delegated
proving service. This means your browser never has to generate the full ZK proof locally.

## Step 1: Initialize your Next.js project

1. Create a new Next.js app with TypeScript:

   ```bash
   yarn create next-app@latest miden-web-app --typescript
   ```

   Hit enter for all terminal prompts.

2. Change into the project directory:

   ```bash
   cd miden-web-app
   ```

3. Install the Miden SDK:

<CodeSdkTabs example={{
  react: { code: `yarn add @miden-sdk/react @miden-sdk/miden-sdk@0.13.0` },
  typescript: { code: `yarn add @miden-sdk/miden-sdk@0.13.0` },
}} reactFilename="" tsFilename="" />

**NOTE!**: Be sure to add the `--webpack` command to your `package.json` when running the `dev script`. The dev script should look like this:

`package.json`

```json
  "scripts": {
    "dev": "next dev --webpack",
    ...
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
        <p className="mb-6">Open your browser console to see WebClient logs.</p>

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

## Step 3 — Initialize the WebClient

Create `lib/react/multiSendWithDelegatedProver.tsx` (React) or `lib/multiSendWithDelegatedProver.ts` (TypeScript) and add the following code. This snippet initializes the WebClient.

```
mkdir -p lib
```

<CodeSdkTabs example={{
react: { code: `'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useMultiSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk';

function MultiSendInner() {
.const { isReady } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { sendMany } = useMultiSend();
.const { waitForCommit } = useWaitForCommit();
.const { waitForConsumableNotes } = useWaitForNotes();

.const run = async () => {
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
  typescript: { code:`export async function multiSendWithDelegatedProver(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.const {
..MidenClient,
..AccountType,
..NoteVisibility,
..StorageMode,
..createP2IDNote,
..OutputNoteArray,
..TransactionRequestBuilder,
.} = await import('@miden-sdk/miden-sdk');

.const client = await MidenClient.create({
..rpcUrl: 'https://rpc.testnet.miden.io',
.});

.console.log('Latest block:', (await client.sync()).blockNum());
}` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Step 4 — Create an account, deploy a faucet, mint and consume tokens

Add the code snippet below to the function. This code creates a wallet and faucet, mints tokens from the faucet for the wallet, and then consumes the minted tokens.

<CodeSdkTabs example={{
react: { code: `// 1. Create Alice's wallet
console.log('Creating account for Alice…');
const alice = await createWallet({ storageMode: StorageMode.Public });
const aliceId = alice.id().toString();
console.log('Alice account ID:', aliceId);

// 2. Deploy a fungible faucet
const faucet = await createFaucet({
.tokenSymbol: 'MID',
.decimals: 8,
.maxSupply: BigInt(1_000_000),
.storageMode: StorageMode.Public,
});
const faucetId = faucet.id().toString();
console.log('Faucet ID:', faucetId);

// 3. Mint 10,000 MID to Alice
const mintResult = await mint({
.faucetId,
.targetAccountId: aliceId,
.amount: BigInt(10_000),
.noteType: NoteVisibility.Public,
});

console.log('Waiting for settlement…');
await waitForCommit(mintResult.transactionId);

// 4. Consume the freshly minted notes
const notes = await waitForConsumableNotes({ accountId: aliceId });
const noteIds = notes.map((n) => n.inputNoteRecord().id());
await consume({ accountId: aliceId, noteIds });`},
  typescript: { code:`// ── Creating new account ──────────────────────────────────────────────────────
console.log('Creating account for Alice…');
const alice = await client.accounts.create({
.type: AccountType.MutableWallet,
.storage: StorageMode.Public,
});
console.log('Alice account ID:', alice.id().toString());

// ── Creating new faucet ──────────────────────────────────────────────────────
const faucet = await client.accounts.create({
.type: AccountType.FungibleFaucet,
.symbol: 'MID',
.decimals: 8,
.maxSupply: BigInt(1_000_000),
.storage: StorageMode.Public,
});
console.log('Faucet ID:', faucet.id().toString());

// ── mint 10 000 MID to Alice ──────────────────────────────────────────────────────
const mintTxId = await client.transactions.mint({
.account: faucet,
.to: alice,
.amount: BigInt(10_000),
.type: NoteVisibility.Public,
});

console.log('waiting for settlement');
await client.transactions.waitFor(mintTxId);
await client.sync();

// ── consume the freshly minted notes ──────────────────────────────────────────────
const noteList = await client.notes.listAvailable({ account: alice });
await client.transactions.consume({
.account: alice,
.notes: noteList.map((n) => n.inputNoteRecord()),
});` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Step 5 — Build and Create P2ID notes

Add the following code to the function. This code defines three recipient addresses, builds three P2ID notes with 100 `MID` each, and then creates all three notes in the same transaction.

<CodeSdkTabs example={{
react: { code: `// 5. Send 100 MID to three recipients in a single transaction
await sendMany({
.from: aliceId,
.assetId: faucetId,
.recipients: [
..{ to: 'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04', amount: BigInt(100) },
..{ to: 'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn', amount: BigInt(100) },
..{ to: 'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd', amount: BigInt(100) },
.],
.noteType: NoteVisibility.Public,
});

console.log('All notes created ✅');`},
  typescript: { code:`// ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
const recipientAddresses = [
.'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04',
.'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn',
.'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd',
];

const p2idNotes = recipientAddresses.map((addr) =>
.createP2IDNote({
..from: alice,
..to: addr,
..assets: { token: faucet, amount: BigInt(100) },
..type: NoteVisibility.Public,
.}),
);

// ── create all P2ID notes ───────────────────────────────────────────────────────────────
const builder = new TransactionRequestBuilder();
const txRequest = builder.withOwnOutputNotes(new OutputNoteArray(p2idNotes)).build();
await client.transactions.submit(alice, txRequest);

console.log('All notes created ✅');` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

## Summary

Your library file should now look like this:

<CodeSdkTabs example={{
react: { code: `'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useMultiSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk';

function MultiSendInner() {
.const { isReady } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { sendMany } = useMultiSend();
.const { waitForCommit } = useWaitForCommit();
.const { waitForConsumableNotes } = useWaitForNotes();

.const run = async () => {
..// 1. Create Alice's wallet
..console.log('Creating account for Alice…');
..const alice = await createWallet({ storageMode: StorageMode.Public });
..const aliceId = alice.id().toString();
..console.log('Alice account ID:', aliceId);

..// 2. Deploy a fungible faucet
..const faucet = await createFaucet({
...tokenSymbol: 'MID',
...decimals: 8,
...maxSupply: BigInt(1_000_000),
...storageMode: StorageMode.Public,
..});
..const faucetId = faucet.id().toString();
..console.log('Faucet ID:', faucetId);

..// 3. Mint 10,000 MID to Alice
..const mintResult = await mint({
...faucetId,
...targetAccountId: aliceId,
...amount: BigInt(10_000),
...noteType: NoteVisibility.Public,
..});

..console.log('Waiting for settlement…');
..await waitForCommit(mintResult.transactionId);

..// 4. Consume the freshly minted notes
..const notes = await waitForConsumableNotes({ accountId: aliceId });
..const noteIds = notes.map((n) => n.inputNoteRecord().id().toString());
..await consume({ accountId: aliceId, noteIds });

..// 5. Send 100 MID to three recipients in a single transaction
..await sendMany({
...from: aliceId,
...assetId: faucetId,
...recipients: [
....{ to: 'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04', amount: BigInt(100) },
....{ to: 'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn', amount: BigInt(100) },
....{ to: 'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd', amount: BigInt(100) },
...],
...noteType: NoteVisibility.Public,
..});

..console.log('All notes created ✅');
.};

.return (
..<div>
...<button onClick={run} disabled={!isReady}>
....{isReady ? 'Run: Multi-Send with Delegated Proving' : 'Initializing…'}
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
  typescript: { code:`/\*\*
.\* Demonstrates multi-send functionality with delegated proving on the Miden Network
.\* Creates multiple P2ID (Pay to ID) notes for different recipients
.\*
.\* @throws {Error} If the function cannot be executed in a browser environment
.\*/
export async function multiSendWithDelegatedProver(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.const {
..MidenClient,
..AccountType,
..NoteVisibility,
..StorageMode,
..createP2IDNote,
..OutputNoteArray,
..TransactionRequestBuilder,
.} = await import('@miden-sdk/miden-sdk');

.const client = await MidenClient.create({
..rpcUrl: 'https://rpc.testnet.miden.io',
.});

.console.log('Latest block:', (await client.sync()).blockNum());

.// ── Creating new account ──────────────────────────────────────────────────────
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..type: AccountType.MutableWallet,
..storage: StorageMode.Public,
.});
.console.log('Alice account ID:', alice.id().toString());

.// ── Creating new faucet ──────────────────────────────────────────────────────
.const faucet = await client.accounts.create({
..type: AccountType.FungibleFaucet,
..symbol: 'MID',
..decimals: 8,
..maxSupply: BigInt(1_000_000),
..storage: StorageMode.Public,
.});
.console.log('Faucet ID:', faucet.id().toString());

.// ── mint 10 000 MID to Alice ──────────────────────────────────────────────────────
.const mintTxId = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(10_000),
..type: NoteVisibility.Public,
.});

.console.log('waiting for settlement');
.await client.transactions.waitFor(mintTxId);
.await client.sync();

.// ── consume the freshly minted notes ──────────────────────────────────────────────
.const noteList = await client.notes.listAvailable({ account: alice });
.await client.transactions.consume({
..account: alice,
..notes: noteList.map((n) => n.inputNoteRecord()),
.});

.// ── build 3 P2ID notes (100 MID each) ─────────────────────────────────────────────
.const recipientAddresses = [
..'mtst1aqezqc90x7dkzypr9m5fmlpp85w6cl04',
..'mtst1apjg2ul76wrkxyr5qlcnczaskypa4ljn',
..'mtst1arpee6y9cm8t7ypn33pc8fzj6gkzz7kd',
.];

.const p2idNotes = recipientAddresses.map((addr) =>
..createP2IDNote({
...from: alice,
...to: addr,
...assets: { token: faucet, amount: BigInt(100) },
...type: NoteVisibility.Public,
..}),
.);

.// ── create all P2ID notes ───────────────────────────────────────────────────────────────
.const builder = new TransactionRequestBuilder();
.const txRequest = builder.withOwnOutputNotes(new OutputNoteArray(p2idNotes)).build();
.await client.transactions.submit(alice, txRequest);

.console.log('All notes created ✅');
}` },
}} reactFilename="lib/react/multiSendWithDelegatedProver.tsx" tsFilename="lib/multiSendWithDelegatedProver.ts" />

### Running the example

To run a full working example navigate to the `web-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run the web application example:

```bash
cd web-client
yarn install
yarn start
```

### Resetting the `MidenClientDB`

The Miden webclient stores account and note data in the browser. To clear the account and node data in the browser, paste this code snippet into the browser console:

```javascript
(async () => {
  const dbs = await indexedDB.databases(); // Get all database names
  for (const db of dbs) {
    await indexedDB.deleteDatabase(db.name);
    console.log(`Deleted database: ${db.name}`);
  }
  console.log('All databases deleted.');
})();
```
