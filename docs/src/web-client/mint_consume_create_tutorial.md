---
title: 'Mint, Consume, and Create Notes'
sidebar_position: 3
---

import { CodeSdkTabs } from '@site/src/components';

_Using the Miden client in TypeScript to mint, consume, and transfer assets_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.
For React snippets, initialize `authScheme` with `await tutorialAuthScheme()`
as shown in the complete example.

:::

## Overview

In the previous tutorial, we set up the foundation - creating Alice's wallet and deploying a faucet. Now we'll put these to use by minting and transferring assets.

## What we'll cover

- Minting assets from a faucet
- Consuming notes to fund an account
- Sending tokens to other users

## Prerequisites

This tutorial builds directly on the previous one. Make sure you have:

- Completed the "Creating Accounts and Deploying Faucets" tutorial
- Your Next.js app with the Miden client set up

## Understanding Notes in Miden

Before we start coding, it's important to understand **notes**:

- Minting a note from a faucet does not automatically add the tokens to your account balance. It creates a note addressed to you.
- You must **consume** a note to add its tokens to your account balance.
- Until consumed, tokens exist in the note but aren't in your account yet.

## Step 1: Mint tokens from the faucet

Let's mint some tokens for Alice. When we mint from a faucet, it creates a note containing the specified amount of tokens targeted to Alice's account.

Add the operations below after funding Alice and the faucet in `createMintConsume`. Import `NoteVisibility` and the shared support functions shown in the complete example. For React, also initialize `useMint`, `useConsume` and `useSend`, and obtain `committed`, `waitForTokenNotes` and `assertBalance` from `useTutorialSupport`.

<CodeSdkTabs example={{
react: { code: `// 3. Mint 1000 tokens to Alice
console.log('Minting tokens to Alice...');
const mintResult = await mint({
.faucetId: faucet, // Faucet account (who mints the tokens)
.targetAccountId: alice, // Target account (who receives the tokens)
.amount: BigInt(1000), // Amount to mint (in base units)
.noteType: NoteVisibility.Public, // Note visibility (public = onchain)
});
console.log('Mint tx:', mintResult.transactionId);

// Wait for the mint transaction to be committed
await committed(mintResult.transactionId);`},
  typescript: { code:`// 4. Mint tokens from the faucet to Alice
console.log("Minting tokens to Alice...");
const { txId: mintTxId } = await client.transactions.mint({
.account: faucet, // Faucet account (who mints the tokens)
.to: alice, // Target account (who receives the tokens)
.amount: BigInt(1000), // Amount to mint (in base units)
.type: NoteVisibility.Public, // Note visibility (public = onchain)
});

// Wait for the transaction to be processed
console.log("Waiting for transaction confirmation...");
await client.transactions.waitFor(mintTxId);` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

### What's happening here?

1. **client.transactions.mint()**: Creates, proves, and submits a mint transaction to Alice. Note that this is only possible to submit transactions on the faucets' behalf if the user controls the faucet (i.e. its keys are stored in the client).
2. **client.transactions.waitFor()**: Polls until the transaction is committed on-chain.

## Step 2: Consume minted notes

After minting, Alice has a note waiting for her but the tokens aren't in her account yet. We need to consume the note to add its assets to her account balance.

Select the tutorial notes before consuming them: v0.16 also exposes globally consumable `TX_FEE` notes. The shared `consumeAllFeeAware` TypeScript helper excludes those fee notes. In React, `waitForTokenNotes` selects committed notes containing our faucet’s token and returns the `InputNoteRecord` values accepted by `useConsume`.

<CodeSdkTabs example={{
react: { code: `// 4. Wait for committed tutorial-token notes, then consume them
const notes = await waitForTokenNotes(alice, faucet);
console.log('Consumable notes:', notes.length);

console.log('Consuming minted notes...');
const consumed = await consume({ accountId: alice.id().toString(), notes });
await committed(consumed.transactionId);
await assertBalance(alice, faucet, BigInt(1000));
console.log('Notes consumed.');`},
typescript: { code:`// 5. Consume Alice's tutorial notes and await confirmation
console.log('Consuming minted notes...');
await consumeAllFeeAware(client, alice);

console.log('Notes consumed.');` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

## Step 3: Sending tokens to other accounts

After consuming the notes, Alice has tokens in her wallet. Now, she wants to send tokens to her friends. She has two options: create a separate transaction for each transfer or batch multiple notes in a single transaction.

_The standard asset transfer note on Miden is the P2ID note (Pay-to-Id). There is also the P2IDE (Pay-to-Id Extended) variant which allows for both timelocking the note (target can only spend the note after a certain block height) and for the note to be reclaimable (the creator of the note can reclaim the note after a certain block height)._

Now that Alice has tokens in her account, she can send some to Bob:

<CodeSdkTabs example={{
react: { code: `// 7. Create Bob and send him 100 tokens
const bob = await createWallet({ storageMode: StorageMode.Public, authScheme });
const bobAddress = bob.id().toString();
console.log("Sending tokens to Bob's account...");
const sent = await send({
.from: alice,
.to: bobAddress,
.assetId: faucet,
.amount: BigInt(100),
.noteType: NoteVisibility.Public,
});
await committed(sent.txId);
await assertBalance(alice, faucet, BigInt(900));
console.log('Tokens sent successfully!');` },
typescript: { code: `// 7. Create Bob and send him tokens
const bob = await client.accounts.create({
.storage: StorageMode.Public,
});
const bobAddress = bob.id().toString();
console.log("Sending tokens to Bob's account...");

await client.transactions.send({
.account: alice, // Sender account
.to: bobAddress, // Recipient address
.token: faucet, // Asset ID (faucet that created the tokens)
.amount: BigInt(100), // Amount to send
.type: NoteVisibility.Public, // Note visibility
.waitForConfirmation: true,
.timeout: 120_000,
});

console.log('Tokens sent successfully!');` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

### Understanding P2ID notes

The transaction creates a **P2ID (Pay-to-ID)** note:

- It's the standard way to transfer assets in Miden
- The note is "locked" to Bob's account ID, i.e. only Bob can consume this note to receive the tokens
- Public notes are visible onchain; private notes would need to be shared offchain (e.g. via a private channel)

## Summary

Here's the complete `lib/react/createMintConsume.tsx` (React) or `lib/createMintConsume.ts` (TypeScript):

<CodeSdkTabs example={{
react: { code: `'use client';

import {
.MidenProvider,
.useMiden,
.useCreateWallet,
.useCreateFaucet,
.useMint,
.useConsume,
.useSend,
} from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
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
.const { mint } = useMint();
.const { consume } = useConsume();
.const { send } = useSend();
.const {
..fundAccount,
..committed,
..waitForTokenNotes,
..waitForNote,
..assertBalance,
.} = useTutorialSupport();

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

..await sync();
..const minted = await mint({
...faucetId: faucet,
...targetAccountId: alice,
...amount: BigInt(1000),
...noteType: NoteVisibility.Public,
..});
..await committed(minted.transactionId);
..const notes = await waitForTokenNotes(alice, faucet);
..const consumed = await consume({ accountId: alice.id().toString(), notes });
..await committed(consumed.transactionId);
..await assertBalance(alice, faucet, BigInt(1000));

..const bob = await createWallet({
...storageMode: StorageMode.Public,
...authScheme,
..});
..const sent = await send({
...from: alice,
...to: bob,
...assetId: faucet,
...amount: BigInt(100),
...noteType: NoteVisibility.Public,
...returnNote: true,
..});
..await committed(sent.txId);
..if (!sent.note) throw new Error('Send did not return its output note');
..await waitForNote(sent.note.id().toString());
..await assertBalance(alice, faucet, BigInt(900));
..console.log('Tokens sent successfully!');
.};

.return (
..<TutorialButton
...name="createMintConsume"
...label="Run: Create, Mint, Consume & Send"
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
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
.consumeAllFeeAware,
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

.// 4. Mint tokens to Alice.
.console.log('Minting tokens to Alice...');
.await client.sync();
.const { txId: mintTxId } = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(1000),
..type: NoteVisibility.Public,
.});
.console.log('Waiting for transaction confirmation...');
.await client.transactions.waitFor(mintTxId, { timeout: 120_000 });

.// 5-6. Consume all available notes for Alice.
.console.log('Consuming minted notes...');
.await consumeAllFeeAware(client, alice);

.console.log('Notes consumed.');

.// 7. Send tokens to Bob
.const bob = await client.accounts.create({
..storage: StorageMode.Public,
.});
.console.log("Sending tokens to Bob's account...");
.await client.sync();
.const { txId: sendTxId } = await client.transactions.send({
..account: alice,
..to: bob,
..token: faucet,
..amount: BigInt(100),
..type: NoteVisibility.Public,
..waitForConfirmation: true,
..timeout: 120_000,
.});
.console.log(\`Transaction committed: \${sendTxId.toHex()}\`);
.const updatedAlice = await client.accounts.get(alice);
.const balance = updatedAlice?.vault().getBalance(faucet.id());
.if (balance !== BigInt(900))
..throw new Error(\`Expected Alice to retain 900 MID, got \${balance}\`);
.console.log('Tokens sent successfully!');
}` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

Let's run the function again. Reload the page and click "Start".

The output will look like this (account IDs and block number vary with live
testnet state):

```
Latest block number: <testnet block>
Creating account for Alice…
Alice ID: <testnet_account_id>
Creating faucet…
Faucet ID: <testnet_account_id>
Minting tokens to Alice...
Waiting for transaction confirmation...
Consuming minted notes...
Notes consumed.
Sending tokens to Bob's account...
Tokens sent successfully!
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

## What's next?

You've now learned the complete note lifecycle in Miden:

1. **Minting** - Creating new tokens from a faucet (issued in notes)
2. **Consuming** - Adding tokens from notes to an account
3. **Transferring** - Sending tokens to other accounts

In the next tutorials, we'll explore:

- Creating multiple notes in a single transaction
- Delegated proving
