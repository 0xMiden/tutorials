---
title: 'How to Use Unauthenticated Notes'
sidebar_position: 6
---

import { CodeSdkTabs } from '@site/src/components';

_Using unauthenticated notes for optimistic note consumption with the Miden client_

:::note v0.16 setup

Follow the [network and fee setup](./setup_guide.md#network-and-fee-setup)
and copy the shared support files imported by the complete example.
For React snippets, initialize `authScheme` with `await tutorialAuthScheme()`
as shown in the complete example.

:::

## Overview

This tutorial passes newly created P2ID notes directly to the next consumer. An unauthenticated input contains the full note without an inclusion proof. The transaction kernel delegates verification of the note's existence to the protocol kernels, allowing the consumer transaction to execute before the producer transaction is confirmed. Final settlement still requires verification by the network.

The Web and React SDKs choose the input mode from the executing client's store: they use an authenticated input when an inclusion proof is available and an unauthenticated input otherwise. Passing a full `Note` supports unauthenticated consumption but does not force that mode; synchronization can make an inclusion proof available.

The example uses one client to manage Alice and five recipient wallets. At each hop, it submits the consumer transaction before waiting for the sender's confirmation, then waits for both transactions before advancing to the next wallet. It verifies the resulting balances; it does not measure transaction latency or guarantee that both transactions settle in the same batch.

The asset follows this chain:

```markdown
Alice ➡ Wallet 1 ➡ Wallet 2 ➡ Wallet 3 ➡ Wallet 4 ➡ Wallet 5
```

## What we'll cover

- **Introduction to Unauthenticated Notes:** Understand what unauthenticated notes are and how they differ from standard notes.
- **Miden Client Setup:** Configure the Miden client for browser-based transactions.
- **P2ID Note Creation:** Learn how to create Pay-to-ID notes for targeted transfers.
- **Confirmation Boundaries:** Distinguish optimistic execution from confirmed settlement.

## Prerequisites

- Node `v20.9.0` or greater (required by the current Next.js template)
- Familiarity with TypeScript
- `yarn`

This tutorial assumes you have a basic understanding of Miden assembly. To quickly get up to speed with Miden assembly (MASM), please play around with running basic Miden assembly programs in the [Miden playground](https://0xmiden.github.io/examples/).

## Step-by-step process

1. **Next.js Project Setup:**
   - Create a new Next.js application with TypeScript.
   - Install the Miden SDK.

2. **Client Initialization:**
   - Set up the Miden client to connect with Miden testnet.

3. **Account Creation:**
   - Create wallet accounts for Alice and multiple transfer recipients.
   - Deploy a fungible faucet for token minting.

4. **Initial Token Setup:**
   - Mint tokens from the faucet to Alice's account.
   - Consume the minted tokens to prepare for transfers.

5. **Unauthenticated Note Transfer Chain:**
   - Create P2ID (Pay-to-ID) notes for each transfer in the chain.
   - Pass each full output note directly to the next consumer.
   - Wait for both transactions to be confirmed and verify the balances.

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

The current Next.js template uses Turbopack by default. Use the webpack configuration from the setup guide and update both scripts in `package.json`:

`package.json`

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
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
mkdir -p lib/react
```

Copy and paste the following code into `lib/react/unauthenticatedNoteTransfer.tsx` (React) or `lib/unauthenticatedNoteTransfer.ts` (TypeScript):

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
.type Account,
} from '@miden-sdk/react/lazy';
import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import { tutorialExplorerUrl, tutorialNetwork } from '../feeSupport';
import {
.TutorialButton,
.tutorialAuthScheme,
.useTutorialSupport,
} from './tutorialSupport';

function UnauthenticatedNoteTransferInner() {
.const { sync } = useMiden();
.const { createWallet } = useCreateWallet();
.const { createFaucet } = useCreateFaucet();
.const { mint } = useMint();
.const { consume } = useConsume();
.const { send } = useSend();
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
..const wallets: Account[] = [];
..for (let index = 0; index < 5; index += 1) {
...const wallet = await createWallet({
....storageMode: StorageMode.Public,
....authScheme,
...});
...console.log(\`Wallet \${index}:\`, wallet.id().toString());
...// Every recipient pays fees when consuming and forwarding the note.
...await fundAccount(wallet);
...wallets.push(wallet);
..}
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

..// Pass full Note objects directly, without fetching an inclusion proof.
..let currentSender = alice;
..for (let index = 0; index < wallets.length; index += 1) {
...const wallet = wallets[index];
...const sent = await send({
....from: currentSender,
....to: wallet,
....assetId: faucet,
....amount: BigInt(50),
....noteType: NoteVisibility.Public,
....returnNote: true,
...});
...if (!sent.note) throw new Error('Send did not return its output note');
...const received = await consume({
....accountId: wallet.id().toString(),
....notes: [sent.note],
...});
...await committed(sent.txId);
...await committed(received.transactionId);
...await assertBalance(wallet, faucet, BigInt(50));
...console.log(
....\`Transfer \${index + 1}: \${tutorialExplorerUrl()}/tx/\${received.transactionId}\`,
...);
...currentSender = wallet;
..}
..await assertBalance(alice, faucet, BigInt(9950));
..for (const wallet of wallets.slice(0, -1))
...await assertBalance(wallet, faucet, BigInt(0));
..console.log('Asset transfer chain completed ✅');
.};

.return (
..<TutorialButton
...name="unauthenticatedNoteTransfer"
...label="Run: Unauthenticated Note Transfer"
...run={run}
../>
.);
}

export default function UnauthenticatedNoteTransfer() {
.return (
..<MidenProvider
...config={{
....rpcUrl: tutorialNetwork(),
....prover: 'local',
....autoSyncInterval: 0,
...}}
..>
...<UnauthenticatedNoteTransferInner />
..</MidenProvider>
.);
}`},
  typescript: { code: `import { NoteVisibility, StorageMode } from '@miden-sdk/miden-sdk/lazy';
import {
.consumeAllFeeAware,
.createTutorialClient,
.fundAccountForFees,
.tutorialExplorerUrl,
} from './feeSupport';

export async function unauthenticatedNoteTransfer(): Promise<void> {
.// Ensure this runs only in a browser context
.if (typeof window === 'undefined') return console.warn('Run in browser');

.const client = await createTutorialClient({
..proverUrl: 'local',
.});

.console.log('Latest block:', (await client.sync()).blockNum());

.// ── Creating new account ──────────────────────────────────────────────────────
.console.log('Creating accounts');

.console.log('Creating account for Alice…');
.const alice = await client.accounts.create({
..storage: StorageMode.Public,
.});
.console.log('Alice account ID:', alice.id().toString());

.const wallets = [];
.for (let i = 0; i < 5; i++) {
..const wallet = await client.accounts.create({
...storage: StorageMode.Public,
..});
..wallets.push(wallet);
..console.log('wallet ', i.toString(), wallet.id().toString());
.}

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

.await client.sync();
.const { txId: mintTxId } = await client.transactions.mint({
..account: faucet,
..to: alice,
..amount: BigInt(10_000),
..type: NoteVisibility.Public,
.});
.console.log('Waiting for settlement');
.await client.transactions.waitFor(mintTxId, { timeout: 120_000 });
.await consumeAllFeeAware(client, alice);

.for (const wallet of wallets) {
..await fundAccountForFees(client, wallet);
.}

.// ── Create unauthenticated note transfer chain ─────────────────────────────────────────────
.// Alice → wallet 1 → wallet 2 → wallet 3 → wallet 4
.for (let i = 0; i < wallets.length; i++) {
..console.log(\`\\nUnauthenticated tx \${i + 1}\`);

..const sender = i === 0 ? alice : wallets[i - 1];
..const receiver = wallets[i];

..console.log('Sender:', sender.id().toString());
..console.log('Receiver:', receiver.id().toString());

..await client.sync();
..const { note, txId: sendTxId } = await client.transactions.send({
...account: sender,
...to: receiver,
...token: faucet,
...amount: BigInt(50),
...type: NoteVisibility.Public,
...returnNote: true,
...waitForConfirmation: false,
..});

..// Pass the full note before waiting for the sender's transaction.
..await client.sync();
..const { txId: consumeTxId } = await client.transactions.consume({
...account: receiver,
...notes: [note],
...waitForConfirmation: true,
...timeout: 120_000,
..});
..await client.transactions.waitFor(sendTxId, { timeout: 120_000 });
..console.log(\`Transaction committed: \${consumeTxId.toHex()}\`);

..console.log(
...\`Consumed Note Tx on MidenScan: \${tutorialExplorerUrl()}/tx/\${consumeTxId.toHex()}\`,
..);
.}

.const lastWallet = await client.accounts.get(wallets[wallets.length - 1]);
.const balance = lastWallet?.vault().getBalance(faucet.id());
.if (balance !== BigInt(50))
..throw new Error(\`Expected last wallet to hold 50 MID, got \${balance}\`);
.console.log('Asset transfer chain completed ✅');
}` },
}} reactFilename="lib/react/unauthenticatedNoteTransfer.tsx" tsFilename="lib/unauthenticatedNoteTransfer.ts" />

## Key Concepts: Unauthenticated Notes

### What are Unauthenticated Notes?

Unauthenticated notes are a powerful feature that allows notes to be:

- **Created and consumed in the same block**
- **Passed to a consuming transaction before block confirmation**
- **Used for optimistic transactions**

### Performance Benefits

By using unauthenticated notes, we can:

- Skip waiting for block confirmation between note creation and consumption
- Submit dependent transaction chains that may be included in a single block
- Begin dependent execution earlier; final settlement still requires network confirmation

### Use Cases

Unauthenticated notes are ideal for:

- **High-frequency trading applications**
- **Payment channels**
- **Micropayment systems**
- **Applications that benefit from optimistic execution before confirmation**

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

Unauthenticated notes let applications submit dependent transactions without first waiting for the producer's confirmation. Creation and consumption may be included in the same block; this does not provide settlement before block production. In this guide, we walked through:

- **Setting up the Miden client** against testnet
- **Creating P2ID Notes** for targeted asset transfers between specific accounts
- **Building Transaction Chains** that submit consumption before waiting for the producer's confirmation
- **Confirmation and balance checks** for the complete transfer chain

By following this guide, you should now have a clear understanding of how to build and deploy high-performance transactions using unauthenticated notes on Miden with the Miden client. Unauthenticated notes are the ideal approach for applications like central limit order books (CLOBs) or other DeFi platforms where transaction speed is critical.

### Resetting the `MidenClientDB`

Stop or terminate the tutorial client and close other tabs using its store before resetting it. This deletes local account data and keys, so use it only for disposable tutorial accounts. The snippet below waits for deletion of the default testnet store; change `name` if you configured a different store.

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

### Running the Full Example

To run a full working example navigate to the `web-client` directory in the [miden-tutorials](https://github.com/0xMiden/miden-tutorials/) repository and run the web application example:

```bash
cd web-client
yarn install
yarn dev
```

### Continue learning

Next tutorial: [Creating Multiple Notes](creating_multiple_notes_tutorial.md)
