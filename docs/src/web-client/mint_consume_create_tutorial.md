---
title: 'Mint, Consume, and Create Notes'
sidebar_position: 3
---

import { CodeSdkTabs } from '@site/src/components';

_Using the Miden client in TypeScript to mint, consume, and transfer assets_

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

Add this to the end of your `createMintConsume` function:

<CodeSdkTabs example={{
react: { code: `// 3. Mint 1000 tokens to Alice
console.log('Minting tokens to Alice...');
const mintResult = await mint({
.faucetId, // Faucet account (who mints the tokens)
.targetAccountId: aliceId, // Target account (who receives the tokens)
.amount: BigInt(1000), // Amount to mint (in base units)
.noteType: NoteVisibility.Public, // Note visibility (public = onchain)
});
console.log('Mint tx:', mintResult.transactionId);

// Wait for the mint transaction to be committed
await waitForCommit(mintResult.transactionId);`},
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

The TypeScript `MidenClient` exposes `client.transactions.consumeAll({ account })` — a single call that finds every consumable note targeted at `account` and consumes them in one transaction. The React SDK instead splits the flow into two hooks: `useWaitForNotes().waitForConsumableNotes(...)` surfaces the notes and `useConsume().consume(...)` consumes them.

<CodeSdkTabs example={{
react: { code: `// 4. Wait for consumable notes to appear, then consume them
const notes = await waitForConsumableNotes({ accountId: alice });
console.log('Consumable notes:', notes.length);

console.log('Consuming minted notes...');
await consume({ accountId: alice.id().toString(), notes });
console.log('Notes consumed.');`},
typescript: { code:`// 5. Consume every consumable note for Alice in a single transaction
console.log('Consuming minted notes...');
await client.transactions.consumeAll({
.account: alice,
});

console.log('Notes consumed.');` },
}} reactFilename="lib/react/createMintConsume.tsx" tsFilename="lib/createMintConsume.ts" />

## Step 3: Sending tokens to other accounts

After consuming the notes, Alice has tokens in her wallet. Now, she wants to send tokens to her friends. She has two options: create a separate transaction for each transfer or batch multiple notes in a single transaction.

_The standard asset transfer note on Miden is the P2ID note (Pay-to-Id). There is also the P2IDE (Pay-to-Id Extended) variant which allows for both timelocking the note (target can only spend the note after a certain block height) and for the note to be reclaimable (the creator of the note can reclaim the note after a certain block height)._

Now that Alice has tokens in her account, she can send some to Bob:

<CodeSdkTabs example={{
react: { code: `// 6. Send 100 tokens to Bob
const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6';
console.log("Sending tokens to Bob's account...");
await send({
.from: aliceId,
.to: bobAddress,
.assetId: faucetId,
.amount: BigInt(100),
.noteType: NoteVisibility.Public,
});
console.log('Tokens sent successfully!');` },
typescript: { code: `// 7. Send tokens from Alice to Bob
const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6';
console.log("Sending tokens to Bob's account...");

await client.transactions.send({
.account: alice, // Sender account ID
.to: bobAddress, // Recipient (bech32 address)
.token: faucet, // Asset ID (faucet that created the tokens)
.amount: BigInt(100), // Amount to send
.type: NoteVisibility.Public, // Note visibility
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

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

function CreateMintConsumeInner() {
.const { isReady } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { send } = useSend();
.const { waitForCommit } = useWaitForCommit();
.const { waitForConsumableNotes } = useWaitForNotes();

.const run = async () => {
..// 1. Create Alice's wallet (public, mutable)
..console.log('Creating account for Alice…');
..const alice = await createWallet({ storageMode: StorageMode.Public });
..const aliceId = alice.id().toString();
..console.log('Alice ID:', aliceId);

..// 2. Deploy a fungible faucet
..console.log('Creating faucet…');
..const faucet = await createFaucet({
...tokenSymbol: 'MID',
...decimals: 8,
...maxSupply: BigInt(1_000_000),
...storageMode: StorageMode.Public,
..});
..const faucetId = faucet.id().toString();
..console.log('Faucet ID:', faucetId);

..// 3. Mint 1000 tokens to Alice
..console.log('Minting tokens to Alice...');
..const mintResult = await mint({
...faucetId,
...targetAccountId: aliceId,
...amount: BigInt(1000),
...noteType: NoteVisibility.Public,
..});
..console.log('Mint tx:', mintResult.transactionId);

..// 4. Wait for the mint transaction to be committed
..await waitForCommit(mintResult.transactionId);

..// 5. Wait for consumable notes to appear, then consume them
..const notes = await waitForConsumableNotes({ accountId: alice });
..console.log('Consumable notes:', notes.length);

..console.log('Consuming minted notes...');
..await consume({ accountId: alice.id().toString(), notes });
..console.log('Notes consumed.');

..// 6. Send 100 tokens to Bob
..const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6';
..console.log("Sending tokens to Bob's account...");
..await send({
...from: aliceId,
...to: bobAddress,
...assetId: faucetId,
...amount: BigInt(100),
...noteType: NoteVisibility.Public,
..});
..console.log('Tokens sent successfully!');
.};

.return (
..<div>
...<button onClick={run} disabled={!isReady}>
....{isReady ? 'Run: Create, Mint, Consume & Send' : 'Initializing…'}
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
import { MidenClient, AccountType, NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

export async function createMintConsume(): Promise<void> {
.if (typeof window === 'undefined') {
..console.warn('webClient() can only run in the browser');
..return;
.}

.// Wait for WASM to be ready before touching any wasm-bindgen type.
.await MidenClient.ready();

.const client = await MidenClient.create({
..rpcUrl: 'https://rpc.testnet.miden.io',
.});

.// 1. Sync with the latest blockchain state
.const state = await client.sync();
.console.log('Latest block number:', state.blockNum());

.// 2. Create Alice's account
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..type: AccountType.RegularAccountUpdatableCode,
..storage: StorageMode.Public,
.});
.console.log('Alice ID:', alice.id().toString());

.// 3. Deploy a fungible faucet
.console.log('Creating faucet…');
.const faucet = await client.accounts.create({
..type: AccountType.FungibleFaucet,
..symbol: 'MID',
..decimals: 8,
..maxSupply: BigInt(1_000_000),
..storage: StorageMode.Public,
.});
.console.log('Faucet ID:', faucet.id().toString());

.// 4. Mint tokens to Alice

.console.log('Minting tokens to Alice...');
.const { txId: mintTxId } = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(1000),
..type: NoteVisibility.Public,
.});

.console.log('Waiting for transaction confirmation...');
.await client.transactions.waitFor(mintTxId);

.// 5-6. Consume all available notes for Alice in a single transaction
.console.log('Consuming minted notes...');
.await client.transactions.consumeAll({
..account: alice,
.});

.console.log('Notes consumed.');

.// 7. Send tokens to Bob
.const bobAddress = 'mtst1apve54rq8ux0jqqqqrkh5y0r0y8cwza6';
.console.log("Sending tokens to Bob's account...");
.await client.transactions.send({
..account: alice,
..to: bobAddress,
..token: faucet,
..amount: BigInt(100),
..type: NoteVisibility.Public,
.});
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

The Miden webclient stores account and note data in the browser. To clear the account and note data in the browser, paste this code snippet into the browser console:

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

## What's next?

You've now learned the complete note lifecycle in Miden:

1. **Minting** - Creating new tokens from a faucet (issued in notes)
2. **Consuming** - Adding tokens from notes to an account
3. **Transferring** - Sending tokens to other accounts

In the next tutorials, we'll explore:

- Creating multiple notes in a single transaction
- Delegated proving
