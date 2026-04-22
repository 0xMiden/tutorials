---
title: 'How to Use Unauthenticated Notes'
sidebar_position: 6
---

import { CodeSdkTabs } from '@site/src/components';

_Using unauthenticated notes for optimistic note consumption with the Miden client_

## Overview

In this tutorial, we will explore how to leverage unauthenticated notes on Miden to settle transactions faster than the blocktime using the Miden client. Unauthenticated notes are essentially UTXOs that have not yet been fully committed into a block. This feature allows the notes to be created and consumed within the same batch during [batch production](https://0xmiden.github.io/miden-docs/imported/miden-base/src/blockchain.html#batch-production).

When using unauthenticated notes, both the creation and consumption of notes can happen within the same batch, enabling faster-than-blocktime settlement. This is particularly powerful for applications requiring high-frequency transactions or optimistic settlement patterns.

We construct a chain of transactions using the unauthenticated notes method on the transaction builder. Unauthenticated notes are also referred to as "erasable notes". We also demonstrate how a note can be created and consumed, highlighting the ability to transfer notes between client instances for asset transfers that can be settled between parties faster than the blocktime.

For example, our demo creates a chain of unauthenticated note transactions:

```markdown
Alice ➡ Wallet 1 ➡ Wallet 2 ➡ Wallet 3 ➡ Wallet 4 ➡ Wallet 5
```

## What we'll cover

- **Introduction to Unauthenticated Notes:** Understand what unauthenticated notes are and how they differ from standard notes.
- **Miden Client Setup:** Configure the Miden client for browser-based transactions.
- **P2ID Note Creation:** Learn how to create Pay-to-ID notes for targeted transfers.
- **Performance Insights:** Observe how unauthenticated notes can reduce transaction times dramatically.

## Prerequisites

- Node `v20` or greater
- Familiarity with TypeScript
- `yarn`

This tutorial assumes you have a basic understanding of Miden assembly. To quickly get up to speed with Miden assembly (MASM), please play around with running basic Miden assembly programs in the [Miden playground](https://0xmiden.github.io/examples/).

## Step-by-step process

1. **Next.js Project Setup:**
   - Create a new Next.js application with TypeScript.
   - Install the Miden SDK.

2. **Client Initialization:**
   - Set up the Miden client to connect with the Miden testnet.

3. **Account Creation:**
   - Create wallet accounts for Alice and multiple transfer recipients.
   - Deploy a fungible faucet for token minting.

4. **Initial Token Setup:**
   - Mint tokens from the faucet to Alice's account.
   - Consume the minted tokens to prepare for transfers.

5. **Unauthenticated Note Transfer Chain:**
   - Create P2ID (Pay-to-ID) notes for each transfer in the chain.
   - Use unauthenticated input notes to consume notes faster than blocktime.
   - Measure and observe the performance benefits.

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
  react: { code: `yarn add @miden-sdk/react @miden-sdk/miden-sdk@0.14.4` },
  typescript: { code: `yarn add @miden-sdk/miden-sdk@0.14.4` },
}} reactFilename="" tsFilename="" />

**NOTE!**: Be sure to add the `--webpack` command to your `package.json` when running the `dev script`. The dev script should look like this:

`package.json`

```json
  "scripts": {
    "dev": "next dev --webpack",
    ...
  }
```

## Step 2: Edit the `app/page.tsx` file

Add the following code to the `app/page.tsx` file. This code defines the main page of our web application:

If you're using the **React SDK**, the page simply renders your self-contained component:

```tsx
// app/page.tsx
'use client';
import UnauthenticatedNoteTransfer from '../lib/react/unauthenticatedNoteTransfer';

export default function Home() {
  return <UnauthenticatedNoteTransfer />;
}
```

If you're using the **TypeScript SDK**, the page manages state and calls the library function directly:

```tsx
// app/page.tsx
'use client';
import { useState } from 'react';
import { unauthenticatedNoteTransfer } from '../lib/unauthenticatedNoteTransfer';

export default function Home() {
  const [isTransferring, setIsTransferring] = useState(false);

  const handleUnauthenticatedNoteTransfer = async () => {
    setIsTransferring(true);
    await unauthenticatedNoteTransfer();
    setIsTransferring(false);
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
            onClick={handleUnauthenticatedNoteTransfer}
            className="w-full px-6 py-3 text-lg cursor-pointer bg-transparent border-2 border-orange-600 text-white rounded-lg transition-all hover:bg-orange-600 hover:text-white"
          >
            {isTransferring
              ? 'Working...'
              : 'Tutorial #4: Unauthenticated Note Transfer'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

## Step 3: Create the Unauthenticated Note Transfer Implementation

Create the library file and add the following code:

```bash
mkdir -p lib
```

Copy and paste the following code into `lib/react/unauthenticatedNoteTransfer.tsx` (React) or `lib/unauthenticatedNoteTransfer.ts` (TypeScript):

<CodeSdkTabs example={{
react: { code: `'use client';

import { MidenProvider, useMiden, useCreateWallet, useCreateFaucet, useMint, useConsume, useSend, useWaitForCommit, useWaitForNotes } from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';

function UnauthenticatedNoteTransferInner() {
.const { isReady } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { send } = useSend();
.const { waitForCommit } = useWaitForCommit();
.const { waitForConsumableNotes } = useWaitForNotes();

.const run = async () => {
..// 1. Create Alice and 5 wallets for the transfer chain
..console.log('Creating accounts…');
..const alice = await createWallet({ storageMode: StorageMode.Public });
..console.log('Alice account ID:', alice.id().toString());

..const wallets = [];
..for (let i = 0; i < 5; i++) {
...const wallet = await createWallet({ storageMode: StorageMode.Public });
...wallets.push(wallet);
...console.log(\`Wallet \${i}:\`, wallet.id().toString());
..}

..// 2. Deploy a fungible faucet
..const faucet = await createFaucet({
...tokenSymbol: 'MID',
...decimals: 8,
...maxSupply: BigInt(1_000_000),
...storageMode: StorageMode.Public,
..});
..console.log('Faucet ID:', faucet.id().toString());

..// 3. Mint 10,000 MID to Alice
..const mintResult = await mint({
...faucetId: faucet,
...targetAccountId: alice,
...amount: BigInt(10_000),
...noteType: NoteVisibility.Public,
..});

..console.log('Waiting for settlement…');
..await waitForCommit(mintResult.transactionId);

..// 4. Consume the freshly minted notes
..const notes = await waitForConsumableNotes({ accountId: alice });
..await consume({ accountId: alice, notes });

..// 5. Create the unauthenticated note transfer chain:
..// Alice → Wallet 0 → Wallet 1 → Wallet 2 → Wallet 3 → Wallet 4
..console.log('Starting unauthenticated transfer chain…');
..let currentSender = alice;
..for (let i = 0; i < wallets.length; i++) {
...const wallet = wallets[i];
...const { note } = await send({
....from: currentSender,
....to: wallet,
....assetId: faucet,
....amount: BigInt(50),
....noteType: NoteVisibility.Public,
....returnNote: true,
...});
...const result = await consume({ accountId: wallet.id().toString(), notes: [note] });
...console.log(
....\`Transfer \${i + 1}: https://testnet.midenscan.com/tx/\${result.transactionId}\`,
...);
...currentSender = wallet;
..}

..console.log('Asset transfer chain completed ✅');
.};

.return (
..<div>
...<button onClick={run} disabled={!isReady}>
....{isReady ? 'Run: Unauthenticated Note Transfer' : 'Initializing…'}
...</button>
..</div>
.);
}

export default function UnauthenticatedNoteTransfer() {
.return (
..<MidenProvider config={{ rpcUrl: 'testnet', prover: 'local' }}>
...<UnauthenticatedNoteTransferInner />
..</MidenProvider>
.);
}`},
  typescript: { code:`import {
.MidenClient,
.AccountType,
.NoteVisibility,
.StorageMode,
} from '@miden-sdk/miden-sdk/lazy';

/\*\*
.\* Demonstrates unauthenticated note transfer chain against Miden testnet
.\* Creates a chain of P2ID (Pay to ID) notes: Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
.\*
.\* @throws {Error} If the function cannot be executed in a browser environment
.\*/
export async function unauthenticatedNoteTransfer(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.// Wait for WASM to be ready before touching any wasm-bindgen type.
.await MidenClient.ready();

.const client = await MidenClient.create({
..rpcUrl: 'https://rpc.testnet.miden.io',
.});

.console.log('Latest block:', (await client.sync()).blockNum());

.// ── Creating accounts ──────────────────────────────────────────────────────
.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..type: AccountType.RegularAccountUpdatableCode,
..storage: StorageMode.Public,
.});
.console.log('Alice account ID:', alice.id().toString());

.const wallets = [];
.for (let i = 0; i < 5; i++) {
..const wallet = await client.accounts.create({
...type: AccountType.RegularAccountUpdatableCode,
...storage: StorageMode.Public,
..});
..wallets.push(wallet);
..console.log('wallet ', i.toString(), wallet.id().toString());
.}

.// ── Creating new faucet ──────────────────────────────────────────────────────
.const faucet = await client.accounts.create({
..type: AccountType.FungibleFaucet,
..symbol: 'MID',
..decimals: 8,
..maxSupply: BigInt(1_000_000),
..storage: StorageMode.Public,
.});
.console.log('Faucet ID:', faucet.id().toString());

.// ── Mint 10,000 MID to Alice ──────────────────────────────────────────────────────
.const { txId: mintTxId } = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(10_000),
..type: NoteVisibility.Public,
.});

.console.log('Waiting for settlement');
.await client.transactions.waitFor(mintTxId);

.// ── Consume the freshly minted note ──────────────────────────────────────────────
.await client.transactions.consumeAll({
..account: alice,
.});

.// ── Create unauthenticated note transfer chain ─────────────────────────────────────────────
.// Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
.for (let i = 0; i < wallets.length; i++) {
..console.log(\`\\nUnauthenticated tx \${i + 1}\`);

..const sender = i === 0 ? alice : wallets[i - 1];
..const receiver = wallets[i];

..console.log('Sender:', sender.id().toString());
..console.log('Receiver:', receiver.id().toString());

..const { note } = await client.transactions.send({
...account: sender,
...to: receiver,
...token: faucet,
...amount: BigInt(50),
...type: NoteVisibility.Public,
...returnNote: true,
..});

..const { txId: consumeTxId } = await client.transactions.consume({
...account: receiver,
...notes: [note],
..});

..console.log(
...\`Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/\${consumeTxId.toHex()}\`,
..);
.}

.console.log('Asset transfer chain completed ✅');
}` },
}} reactFilename="lib/react/unauthenticatedNoteTransfer.tsx" tsFilename="lib/unauthenticatedNoteTransfer.ts" />

## Key Concepts: Unauthenticated Notes

### What are Unauthenticated Notes?

Unauthenticated notes are a powerful feature that allows notes to be:

- **Created and consumed in the same block**
- **Transferred faster than blocktime**
- **Used for optimistic transactions**

### Performance Benefits

By using unauthenticated notes, we can:

- Skip waiting for block confirmation between note creation and consumption
- Create transaction chains that execute within a single block
- Achieve sub-blocktime settlement for certain use cases

### Use Cases

Unauthenticated notes are ideal for:

- **High-frequency trading applications**
- **Payment channels**
- **Micropayment systems**
- **Any scenario requiring fast settlement**

## Running the Example

To run the unauthenticated note transfer example:

```bash
cd miden-web-app
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser, click the **"Tutorial #4: Unauthenticated Note Transfer"** button, and check the browser console for detailed logs.

### Expected Output

You should see output similar to this in the browser console (account IDs,
block number, and transaction hashes vary with live testnet state):

```
Latest block: <testnet block>
Creating accounts
Creating account for Alice…
Alice account ID: <testnet_account_id>
wallet  0 <testnet_account_id>
wallet  1 <testnet_account_id>
wallet  2 <testnet_account_id>
wallet  3 <testnet_account_id>
wallet  4 <testnet_account_id>
Faucet ID: <testnet_account_id>
Waiting for settlement

Unauthenticated tx 1
Sender: <testnet_account_id>
Receiver: <testnet_account_id>
Consumed Note Tx on MidenScan: https://testnet.midenscan.com/tx/<tx_hash>

Unauthenticated tx 2
...

Asset transfer chain completed ✅
```

## Conclusion

Unauthenticated notes on Miden offer a powerful mechanism for achieving faster asset settlements by allowing notes to be both created and consumed within the same block. In this guide, we walked through:

- **Setting up the Miden client** against testnet
- **Creating P2ID Notes** for targeted asset transfers between specific accounts
- **Building Transaction Chains** using unauthenticated input notes for sub-blocktime settlement
- **Performance Observations** demonstrating how unauthenticated notes enable faster-than-blocktime transfers

By following this guide, you should now have a clear understanding of how to build and deploy high-performance transactions using unauthenticated notes on Miden with the Miden client. Unauthenticated notes are the ideal approach for applications like central limit order books (CLOBs) or other DeFi platforms where transaction speed is critical.

### Resetting the `MidenClientDB`

The Miden webclient stores account and note data in the browser. If you get errors such as "Failed to build MMR", then you should reset the Miden webclient store. When switching between Miden networks such as from localhost to testnet be sure to reset the browser store. To clear the account and node data in the browser, paste this code snippet into the browser console:

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

### Running the Full Example

To run a full working example navigate to the `web-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run the web application example:

```bash
cd web-client
yarn install
yarn start
```

### Continue learning

Next tutorial: [Creating Multiple Notes](creating_multiple_notes_tutorial.md)
